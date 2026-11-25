import { createClient } from 'npm:@supabase/supabase-js@2';

// push-reminders: automatic study/streak/exam push reminders.
// Triggered by an EXTERNAL scheduler (no pg_cron in this DB) with
// header x-push-secret and body { slot, dry_run? }.
// All sends go through the send-push edge function (single source of truth
// for FCM delivery, per-category prefs and push_analytics).
// Dedupe + daily cap are enforced via public.push_reminder_log:
// a row is inserted BEFORE sending; if the send definitively fails the row
// is removed so a later slot may retry. A crash can therefore lose a
// reminder but can never double-send one.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-push-secret",
};

const TZ = 'Asia/Karachi';
const DAILY_CAP = 3;

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// ---------- Asia/Karachi date helpers ----------
function pktParts(d: Date) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false,
  });
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(d)) parts[p.type] = p.value;
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) % 24 };
}
function pktDateOf(d: Date): string {
  return pktParts(d).date;
}
function addDays(dateStr: string, n: number): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
// UTC ISO instant of 00:00 PKT on a given PKT date (PKT = UTC+5, no DST).
function pktDayStartIso(dateStr: string): string {
  return new Date(`${dateStr}T00:00:00+05:00`).toISOString();
}


// ─── chat-uploads retention (audit F-03) ──────────────────────────
// Chat attachment objects are kept for 30 days, then deleted by this
// hourly job (throttled per worker). Before this, uploaded chat files
// accumulated in the private bucket forever. Best-effort: a cleanup
// failure never affects reminder sending.
const RETENTION_DAYS = 30;
let lastCleanupMs = 0;
async function cleanupOldChatUploads(): Promise<void> {
  const nowMs = Date.now();
  if (nowMs - lastCleanupMs < 6 * 3600_000) return;
  lastCleanupMs = nowMs;
  try {
    const cutoff = nowMs - RETENTION_DAYS * 86400_000;
    const { data: root } = await supabase.storage.from('chat-uploads').list('', { limit: 200 });
    if (!root) return;
    const stale: string[] = [];
    for (const entry of root) {
      if (entry.id) {
        // file stored at bucket root
        if (new Date(entry.created_at).getTime() < cutoff) stale.push(entry.name);
        continue;
      }
      const { data: files } = await supabase.storage.from('chat-uploads').list(entry.name, { limit: 200 });
      for (const f of files ?? []) {
        if (f.id && new Date(f.created_at).getTime() < cutoff) stale.push(`${entry.name}/${f.name}`);
      }
    }
    for (let i = 0; i < stale.length; i += 100) {
      await supabase.storage.from('chat-uploads').remove(stale.slice(i, i + 100));
    }
    if (stale.length) console.log(`chat-uploads retention: deleted ${stale.length} object(s) older than ${RETENTION_DAYS}d`);
  } catch (e) {
    console.warn('chat-uploads retention cleanup failed:', e);
  }
}

type Slot = 'midday' | 'evening' | 'late' | 'hourly';
type Phase = 'midday' | 'evening' | 'late' | 'none';

function resolvePhase(slot: Slot, pktHour: number): Phase {
  if (slot === 'midday' || slot === 'evening' || slot === 'late') return slot;
  // 'hourly': map the current Karachi hour to a phase so an hourly caller is safe.
  if (pktHour >= 10 && pktHour < 15) return 'midday';
  if (pktHour >= 15 && pktHour < 20) return 'evening';
  if (pktHour >= 20) return 'late';
  return 'none';
}

interface Candidate {
  user_id: string;
  rule: string;       // full dedupe key, e.g. 'streak_evening' or 'exam_tomorrow:<examId>'
  base: string;       // reporting group, e.g. 'streak_evening' / 'exam_tomorrow'
  category: string;
  title: string;
  body: string;
  link: string;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    // ---- Auth: same pattern as send-push (internal shared secret, or admin JWT) ----
    const providedSecret = req.headers.get('x-push-secret') || '';
    const authHeader = req.headers.get('Authorization') || '';
    let authorized = false;

    if (providedSecret) {
      const { data: expected } = await supabase.rpc('get_send_push_secret');
      if (typeof expected === 'string' && expected.length === providedSecret.length) {
        let diff = 0;
        for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ providedSecret.charCodeAt(i);
        authorized = diff === 0;
      }
    }
    if (!authorized && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      const { data: userData } = await supabase.auth.getUser(token);
      const uid = userData?.user?.id;
      if (uid) {
        const { data: roleRow } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', uid)
          .eq('role', 'admin')
          .maybeSingle();
        if (roleRow) authorized = true;
      }
    }
    if (!authorized) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const reqBody = await req.json().catch(() => ({})) as { slot?: Slot; dry_run?: boolean };
    const slot: Slot = (['midday', 'evening', 'late', 'hourly'].includes(reqBody.slot || '') ? reqBody.slot : 'hourly') as Slot;
    const dryRun = reqBody.dry_run === true;
    await cleanupOldChatUploads();

    const now = new Date();
    const { date: today, hour: pktHour } = pktParts(now);
    const yesterday = addDays(today, -1);
    const tomorrow = addDays(today, 1);
    const phase = resolvePhase(slot, pktHour);

    if (phase === 'none') {
      return new Response(JSON.stringify({ ok: true, slot, phase, dry_run: dryRun, date_pkt: today, counts: {}, total_candidates: 0, note: 'outside reminder hours' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ---------- Load push-enabled audience ----------
    const { data: subRows, error: subErr } = await supabase
      .from('push_subscriptions')
      .select('user_id, notification_preferences')
      .eq('enabled', true);
    if (subErr) throw subErr;
    const prefsByUser = new Map<string, any[]>();
    for (const r of subRows || []) {
      const arr = prefsByUser.get(r.user_id) || [];
      arr.push(r.notification_preferences || {});
      prefsByUser.set(r.user_id, arr);
    }
    const userIds = Array.from(prefsByUser.keys());
    // A user is eligible for a category if ANY enabled device hasn't turned it off
    // (send-push applies the same !== false rule per subscription at send time).
    const eligible = (uid: string, category: string) =>
      (prefsByUser.get(uid) || []).some((p) => p?.[category] !== false);

    const candidates: Candidate[] = [];
    if (userIds.length) {
      // ---------- Load supporting data ----------
      const [{ data: streakRows }, { data: planRows }, { data: sessionRows }, { data: profileRows }, { data: examRows }, { data: taskAnyRows }, { data: taskTodayRows }] =
        await Promise.all([
          supabase.from('daily_streaks').select('user_id, current_streak, last_active_date').in('user_id', userIds),
          supabase.from('study_plans').select('user_id, semester, weekly_hours, created_at').in('user_id', userIds).order('created_at', { ascending: false }),
          supabase.from('study_sessions').select('user_id')
            .gte('studied_at', pktDayStartIso(today)).lt('studied_at', pktDayStartIso(tomorrow))
            .in('user_id', userIds),
          supabase.from('profiles').select('user_id, current_semester').in('user_id', userIds),
          supabase.from('exam_schedule').select('id, subject, exam_type, exam_date, semester')
            .gte('exam_date', pktDayStartIso(yesterday)).lt('exam_date', pktDayStartIso(addDays(tomorrow, 1))),
          // Daily plan tasks: existence check (any date) + today's tasks.
          supabase.from('plan_tasks').select('user_id').in('user_id', userIds),
          supabase.from('plan_tasks').select('user_id, subject, title, done, created_at')
            .eq('task_date', today).in('user_id', userIds).order('created_at', { ascending: true }),
        ]);

      const streakByUser = new Map((streakRows || []).map((r: any) => [r.user_id, r]));
      const planByUser = new Map<string, any>();
      for (const p of planRows || []) if (!planByUser.has(p.user_id)) planByUser.set(p.user_id, p); // latest plan
      const studiedToday = new Set((sessionRows || []).map((r: any) => r.user_id));
      const semesterByUser = new Map((profileRows || []).map((r: any) => [r.user_id, r.current_semester]));

      const examsToday = (examRows || []).filter((e: any) => pktDateOf(new Date(e.exam_date)) === today);
      const examsTomorrow = (examRows || []).filter((e: any) => pktDateOf(new Date(e.exam_date)) === tomorrow);

      // ---------- Rule: EXAM (semester-wide schedule -> users of that semester) ----------
      const examRule = (exam: any, when: 'today' | 'tomorrow') => {
        for (const uid of userIds) {
          if (semesterByUser.get(uid) !== exam.semester) continue;
          if (!eligible(uid, 'exam_reminder')) continue;
          candidates.push({
            user_id: uid,
            rule: `exam_${when}:${exam.id}`,
            base: `exam_${when}`,
            category: 'exam_reminder',
            title: when === 'today' ? 'Exam today! 🎯' : 'Exam tomorrow! 📝',
            body: when === 'today'
              ? `${exam.subject} (${exam.exam_type}) is scheduled today. Good luck — give it your best!`
              : `${exam.subject} (${exam.exam_type}) is tomorrow. Revise well tonight — all the best!`,
            link: '/',
          });
        }
      };
      if (phase === 'midday') for (const e of examsToday) examRule(e, 'today');
      if (phase === 'evening') for (const e of examsTomorrow) examRule(e, 'tomorrow');

      // ---------- Rule: PLAN (daily tasks first, weekly plan as fallback) ----------
      // Daily tasks (plan_tasks) take precedence for users who have any:
      //  - a pending task for today (PKT) -> the reminder names the first
      //    pending task (title + subject) instead of the generic message;
      //  - all of today's tasks done -> no plan reminder for that user;
      //  - tasks exist but none are scheduled today -> generic behaviour.
      // Users with NO plan_tasks at all keep the original generic behaviour:
      // plan exists AND no study_sessions row today (PKT).
      const hasAnyTasks = new Set((taskAnyRows || []).map((r: any) => r.user_id));
      const todaysTasksByUser = new Map<string, any[]>();
      for (const t of taskTodayRows || []) {
        const arr = todaysTasksByUser.get(t.user_id) || [];
        arr.push(t);
        todaysTasksByUser.set(t.user_id, arr);
      }
      if (phase === 'midday') {
        for (const uid of userIds) {
          if (!eligible(uid, 'study_reminder')) continue;
          if (hasAnyTasks.has(uid)) {
            const todays = todaysTasksByUser.get(uid) || [];
            if (todays.length) {
              const pending = todays.filter((t: any) => !t.done);
              if (!pending.length) continue; // all today's tasks done -> skip
              const first = pending[0];
              const subjectPart = first.subject ? ` (${first.subject})` : '';
              candidates.push({
                user_id: uid,
                rule: 'plan_midday',
                base: 'plan_midday',
                category: 'study_reminder',
                title: "Today's study task 📚",
                body: pending.length > 1
                  ? `Today's task: ${first.title}${subjectPart} — plus ${pending.length - 1} more pending task${pending.length - 1 > 1 ? 's' : ''} today. Let's start!`
                  : `Today's task: ${first.title}${subjectPart} — let's get it done!`,
                link: '/',
              });
              continue;
            }
            // Has tasks, but none scheduled today -> fall through to generic.
          }
          const plan = planByUser.get(uid);
          if (!plan) continue;
          if (studiedToday.has(uid)) continue;
          candidates.push({
            user_id: uid,
            rule: 'plan_midday',
            base: 'plan_midday',
            category: 'study_reminder',
            title: "Today's study plan 📚",
            body: `Your Semester ${plan.semester} plan targets ${plan.weekly_hours}h/week — no study session logged yet today. Let's start one!`,
            link: '/',
          });
        }
      }

      // ---------- Rule: STREAK (mirror of record_daily_activity / daily_streaks) ----------
      // App definition: activity on a day sets last_active_date; the streak only
      // survives if the user is active again the NEXT day. So a streak is
      // saveable-but-unsaved iff current_streak >= 2 AND last_active_date =
      // yesterday (PKT). last_active_date = today -> already safe, skip.
      // Older -> already lapsed (app resets to 1 on next open), skip.
      const streakRuleKey = `streak_${phase}`;
      if (phase === 'midday' || phase === 'evening' || phase === 'late') {
        for (const uid of userIds) {
          const s = streakByUser.get(uid);
          if (!s) continue;
          if ((s.current_streak ?? 0) < 2) continue;
          const lad = typeof s.last_active_date === 'string' ? s.last_active_date.slice(0, 10) : pktDateOf(new Date(s.last_active_date));
          if (lad !== yesterday) continue;
          if (!eligible(uid, 'streak_alert')) continue;
          const n = s.current_streak;
          const copy = phase === 'midday'
            ? { title: 'Keep your streak alive 🔥', body: `You have a ${n}-day streak going. A short study session today will keep it alive.` }
            : phase === 'evening'
              ? { title: 'Your streak is about to end! ⚠️', body: `Your ${n}-day streak ends tonight if you don't study. Do a short study session — save your streak!` }
              : { title: 'Last chance to save your streak 🚨', body: `Only today is left — your ${n}-day streak resets at midnight. Open UniGenius and study now!` };
          candidates.push({
            user_id: uid,
            rule: streakRuleKey,
            base: streakRuleKey,
            category: 'streak_alert',
            title: copy.title,
            body: copy.body,
            link: '/',
          });
        }
      }
    }

    // ---------- Dedupe + daily cap state ----------
    const { data: logRows } = await supabase
      .from('push_reminder_log')
      .select('user_id, rule')
      .eq('sent_date', today);
    const alreadySent = new Set((logRows || []).map((r: any) => `${r.user_id}|${r.rule}`));
    const dayCount = new Map<string, number>();
    for (const r of logRows || []) dayCount.set(r.user_id, (dayCount.get(r.user_id) || 0) + 1);

    // Priority order is the candidate build order: exam, then plan, then streak.
    const counts: Record<string, number> = {};
    const samples: Record<string, string[]> = {};
    const actionable: Candidate[] = [];
    for (const c of candidates) {
      if (alreadySent.has(`${c.user_id}|${c.rule}`)) continue;
      if ((dayCount.get(c.user_id) || 0) >= DAILY_CAP) continue;
      // Reserve the cap slot within this run too (dry-run counts reflect the cap).
      dayCount.set(c.user_id, (dayCount.get(c.user_id) || 0) + 1);
      counts[c.base] = (counts[c.base] || 0) + 1;
      (samples[c.base] = samples[c.base] || []).push(c.user_id);
      actionable.push(c);
    }
    for (const k of Object.keys(samples)) samples[k] = samples[k].slice(0, 5);

    if (dryRun) {
      return new Response(JSON.stringify({
        ok: true, slot, phase, dry_run: true, date_pkt: today,
        counts, total_candidates: actionable.length, sample_user_ids: samples,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ---------- Live send via send-push ----------
    let pushSecret = '';
    {
      const { data } = await supabase.rpc('get_send_push_secret');
      if (typeof data === 'string') pushSecret = data;
    }
    const sendPushUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/send-push`;

    const perRule: Record<string, { candidates: number; sent: number; failed: number }> = {};
    let totalSent = 0, totalFailed = 0;

    for (const c of actionable) {
      perRule[c.base] = perRule[c.base] || { candidates: 0, sent: 0, failed: 0 };
      perRule[c.base].candidates++;

      // Insert the dedupe row BEFORE sending: a crash after this point loses
      // the reminder but can never double-send it on a re-run.
      const { error: insErr } = await supabase
        .from('push_reminder_log')
        .insert({ user_id: c.user_id, rule: c.rule, sent_date: today });
      if (insErr) { perRule[c.base].failed++; totalFailed++; continue; } // conflict -> someone else sent it

      let okSend = false;
      try {
        const res = await fetch(sendPushUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-push-secret': pushSecret },
          body: JSON.stringify({
            target: 'user', user_id: c.user_id, category: c.category,
            title: c.title, body: c.body, link: c.link,
          }),
        });
        const j = await res.json().catch(() => ({}));
        okSend = res.ok && (j?.sent ?? 0) >= 1;
      } catch { okSend = false; }

      if (okSend) {
        perRule[c.base].sent++; totalSent++;
      } else {
        // Definitive failure: release the dedupe row so a later slot can retry.
        await supabase.from('push_reminder_log')
          .delete().eq('user_id', c.user_id).eq('rule', c.rule).eq('sent_date', today);
        perRule[c.base].failed++; totalFailed++;
      }
    }

    return new Response(JSON.stringify({
      ok: true, slot, phase, dry_run: false, date_pkt: today,
      counts, total_candidates: actionable.length,
      sent: totalSent, failed: totalFailed, per_rule: perRule,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e: any) {
    console.error('push-reminders error', e);
    return new Response(JSON.stringify({ error: e.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
