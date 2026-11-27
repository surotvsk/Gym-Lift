package surotvsk.gymapp.wear;

import android.Manifest;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.Settings;
import android.text.InputFilter;
import android.text.InputType;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.ViewConfiguration;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONArray;
import org.json.JSONObject;
import java.text.NumberFormat;
import java.util.List;
import java.util.Locale;

/** Jednoduché skrolovateľné Views s bezpečným okrajom pre okrúhly displej. */
public final class WatchActivity extends Activity {
    private static final int LIME = 0xFFD6F35A, TEXT = 0xFFF4F3EF, MUTED = 0xFFA6A5A0, SURFACE = 0xFF1A1A1C, WARN = 0xFFFFB454;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private WatchLink link;
    private WatchTimer timer;
    private ScrollView scroll;
    private LinearLayout column;
    private TextView countdown, commandStatus;
    private String page = "home", language = "";
    /** Vybraná relácia (UUID, nie súkromný obsah). ID konverzácie žije len v poli, nikdy v uloženom stave okna. */
    private String sessionId = "", chatId = "";
    /** Dialóg s textom odpovede/potvrdením: sleduje sa, aby sa pri strate čerstvého pripojenia, súhlasu alebo väzby zatvoril. */
    private AlertDialog privateDialog;
    private EditText privateInput;
    private String privateChatId = "";
    private int timerShape = Integer.MIN_VALUE;
    private final char[] clockDigits = new char[16];
    private char zeroDigit = java.text.DecimalFormatSymbols.getInstance().getZeroDigit();
    private long clockSeconds = -1;
    private long revision = -1, ticks;
    private boolean timerWasLive;
    private final Runnable ticker = new Runnable() {
        @Override public void run() {
            try {
                guardPrivate();
                if (ticks++ % 3 == 0) link.refresh();
                link.syncNow();
                JSONObject local = timer.state();
                int shape = local.optString("id").hashCode();
                shape = 31 * shape + (local.optBoolean("paused") ? 1 : 0);
                shape = 31 * shape + (local.optBoolean("done") ? 1 : 0);
                shape = 31 * shape + (local.optBoolean("restored") ? 1 : 0);
                shape = 31 * shape + (timer.exact() ? 1 : 0);
                shape = 31 * shape + (timer.notifications() ? 1 : 0);
                long current = link.revision();
                String nextLanguage = link.language();
                if (!nextLanguage.isEmpty() && !nextLanguage.equals(language)) setLanguage(nextLanguage);
                if (current != revision || shape != timerShape) {
                    revision = current; timerShape = shape; render(true);
                }
                updateClocks();
            } catch (Exception e) { failure(R.string.timer_error); }
            handler.postDelayed(this, 1000);
        }
    };
    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        link = WatchLink.get(this); timer = WatchTimer.get(this);
        if (savedInstanceState != null) {
            page = savedInstanceState.getString("page", "home"); sessionId = savedInstanceState.getString("session", "");
            if (page.equals("chat")) page = "messages";
            if (page.equals("session") && sessionId.isEmpty()) page = "workout";
        }
        scroll = new ScrollView(this); scroll.setFillViewport(true); scroll.setClipToPadding(false);
        column = new LinearLayout(this); column.setOrientation(LinearLayout.VERTICAL); column.setGravity(Gravity.CENTER_HORIZONTAL);
        boolean round = getResources().getConfiguration().isScreenRound();
        int side = round ? Math.max(24, getResources().getConfiguration().screenWidthDp / 7) : 16;
        column.setPadding(dp(side), dp(round ? 30 : 16), dp(side), dp(round ? 44 : 24));
        scroll.addView(column, new ScrollView.LayoutParams(-1, -2));
        scroll.setFocusable(true);
        final float rotary = ViewConfiguration.get(this).getScaledVerticalScrollFactor();
        scroll.setOnGenericMotionListener((v, event) -> {
            if (event.getAction() != MotionEvent.ACTION_SCROLL) return false;
            float delta = event.getAxisValue(MotionEvent.AXIS_SCROLL);
            if (delta == 0) return false;
            scroll.scrollBy(0, Math.round(-delta * rotary)); return true;
        });
        setContentView(scroll); scroll.requestFocus(); render(false);
    }
    @Override protected void onResume() {
        super.onResume(); timer.restore(); link.refresh(); handler.removeCallbacks(ticker); handler.post(ticker);
    }
    @Override protected void onPause() { dismissPrivate(); handler.removeCallbacks(ticker); super.onPause(); }
    @Override protected void onSaveInstanceState(Bundle out) {
        out.putString("page", page.equals("chat") ? "messages" : page); out.putString("session", sessionId);
        super.onSaveInstanceState(out);
    }
    @Override public void onBackPressed() {
        if (page.equals("home")) super.onBackPressed(); else go(backTarget());
    }
    private String backTarget() { return page.equals("chat") ? "messages" : "home"; }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private void setLanguage(String tag) {
        language = tag;
        Configuration config = new Configuration(getResources().getConfiguration());
        Locale locale = Locale.forLanguageTag(tag); config.setLocale(locale); config.setLayoutDirection(locale);
        zeroDigit = java.text.DecimalFormatSymbols.getInstance(locale).getZeroDigit();
        clockSeconds = -1;
        getResources().updateConfiguration(config, getResources().getDisplayMetrics());
        column.setLayoutDirection(config.getLayoutDirection()); revision = -1;
    }
    private TextView text(CharSequence value, int size, int color) {
        TextView view = new TextView(this); view.setText(value); view.setTextSize(size); view.setTextColor(color);
        view.setGravity(Gravity.CENTER); view.setPadding(0, dp(5), 0, dp(5));
        column.addView(view, new LinearLayout.LayoutParams(-1, -2)); return view;
    }
    private void note(int resource) { text(getString(resource), 13, MUTED); }
    private void title(int resource) { TextView t = text(getString(resource), 21, TEXT); t.setTypeface(null, Typeface.BOLD); }
    private Button styled(CharSequence label, boolean enabled, boolean accent) {
        Button button = new Button(this); button.setText(label); button.setAllCaps(false); button.setTextSize(14);
        button.setTextColor(accent ? 0xFF121212 : enabled ? LIME : MUTED); button.setMinHeight(dp(48)); button.setGravity(Gravity.CENTER);
        button.setPadding(dp(8), dp(6), dp(8), dp(6));
        GradientDrawable background = new GradientDrawable(); background.setColor(accent ? LIME : SURFACE); background.setCornerRadius(dp(24));
        button.setBackground(background); button.setEnabled(enabled); button.setAlpha(enabled ? 1f : .55f);
        return button;
    }
    private Button button(CharSequence label, boolean enabled, Runnable action) {
        Button button = styled(label, enabled, false);
        LinearLayout.LayoutParams params = new LinearLayout.LayoutParams(-1, -2); params.setMargins(0, dp(4), 0, dp(4));
        column.addView(button, params); button.setOnClickListener(v -> action.run()); return button;
    }
    private void button(int label, Runnable action) { button(getString(label), true, action); }
    private void go(String next) { if (!next.equals("chat")) dismissPrivate(); page = next; render(false); scroll.scrollTo(0, 0); }
    private void render(boolean preserveScroll) {
        int oldY = preserveScroll ? scroll.getScrollY() : 0;
        column.removeAllViews(); countdown = null; commandStatus = null; clockSeconds = -1;
        JSONObject snapshot = link.visible();
        switch (page) {
            case "workout": workout(snapshot); break;
            case "session": session(); break;
            case "messages": messages(); break;
            case "chat": chat(); break;
            case "rest":
                title(R.string.rest_timer);
                button(R.string.phone_timer, () -> go("phone")); button(R.string.watch_only, () -> go("local")); break;
            case "phone": phoneTimer(snapshot); break;
            case "local": localTimer(); break;
            case "timer-settings": timerPermissions(); break;
            case "calendar": calendar(snapshot); break;
            case "link": linking(snapshot); break;
            default: home(snapshot);
        }
        if (!page.equals("home")) button(R.string.back, () -> go(backTarget()));
        scroll.post(() -> scroll.scrollTo(0, oldY)); updateClocks();
    }
    private void home(JSONObject snapshot) {
        title(R.string.home);
        if (snapshot == null) note(link.linkedGeneration() ? R.string.disconnected : R.string.not_linked);
        else text(getString(R.string.linked_to, snapshot.optJSONObject("binding").optString("label")), 12, MUTED);
        WatchJournal journal = link.journal();
        JSONObject open = journal.openSession();
        if (open != null) {
            text(planName(open), 17, LIME);
            text(getString(R.string.session_progress, WatchJournal.done(open), WatchJournal.totalKeys(open)), 14, TEXT);
            text(getString(statusText(open)), 12, statusColor(open));
        }
        Button start = styled(getString(open != null ? R.string.resume_workout : R.string.start_workout), true, true);
        LinearLayout.LayoutParams startParams = new LinearLayout.LayoutParams(-1, -2); startParams.setMargins(0, dp(4), 0, dp(4));
        column.addView(start, startParams);
        start.setOnClickListener(v -> { if (open != null) { sessionId = open.optString("sessionId"); go("session"); } else go("workout"); });
        if (open == null && link.unsynced() > 0) text(getString(R.string.unsynced_workouts, link.unsynced()), 12, WARN);
        button(R.string.rest_timer, () -> go("rest"));
        if (link.messages() != null || link.grant("messages")) button(unreadLabel(), true, () -> go("messages"));
        button(R.string.calendar, () -> go("calendar")); button(R.string.connect_phone, () -> go("link"));
    }
    private String planName(JSONObject session) {
        JSONObject plan = session.optJSONObject("plan"); return plan == null ? "" : plan.optString("name");
    }
    private boolean requirePhone(JSONObject snapshot) {
        if (snapshot != null) return true;
        note(link.linkedGeneration() ? R.string.unavailable : R.string.unlinked_help); return false;
    }
    private void status() { commandStatus = text(getString(link.outcome()), 13, MUTED); }
    private JSONObject args(String key, Object value) {
        JSONObject object = new JSONObject();
        try { object.put(key, value); } catch (Exception e) { throw new IllegalArgumentException(e); }
        return object;
    }
    private void send(String type, JSONObject args) { link.submit(type, args); render(true); }

    /* ---------- tréning: uložené plány, denník, stavy ---------- */
    private int errorText(RuntimeException e) {
        String code = e instanceof JournalError ? ((JournalError) e).code : "";
        switch (code) {
            case "open_exists": case "too_many": case "session_known": return R.string.start_refused;
            case "pack_expired": return R.string.cache_expired;
            case "journal_full": return R.string.journal_full;
            case "storage_unreadable": return R.string.journal_unreadable;
            default: return R.string.journal_save_error;
        }
    }
    private int statusText(JSONObject s) {
        String code = WatchJournal.status(s); boolean open = "open".equals(s.optString("state"));
        if (code.equals("review")) return R.string.status_review;
        if (code.equals("conflict")) return R.string.status_conflict;
        if (open) return code.equals("staged") ? R.string.status_staged_open : code.equals("local") ? R.string.status_local_open : R.string.status_waiting_open;
        return code.equals("staged") ? R.string.status_staged_finished : R.string.status_local_finished;
    }
    private int statusColor(JSONObject s) {
        String code = WatchJournal.status(s); return code.equals("review") || code.equals("conflict") ? WARN : MUTED;
    }
    private int resultText(String status) {
        return status.equals("imported") ? R.string.result_imported : status.equals("duplicate") ? R.string.result_duplicate : R.string.result_discarded;
    }
    private void startLocal(String planId) {
        try { sessionId = link.startPlan(planId); go("session"); }
        catch (RuntimeException e) { failure(errorText(e)); render(true); }
    }
    private void continueLocal() {
        try { sessionId = link.continueActive(); go("session"); }
        catch (RuntimeException e) { failure(errorText(e)); render(true); }
    }
    private void workout(JSONObject snapshot) {
        WatchJournal journal = link.journal();
        JSONObject open = journal.openSession();
        if (open != null) { sessionId = open.optString("sessionId"); page = "session"; session(); return; }
        title(R.string.start_workout);
        text(getString(snapshot == null ? R.string.mode_offline : R.string.mode_online), 12, snapshot == null ? WARN : MUTED);
        if (journal.unreadable()) { note(R.string.journal_unreadable); }
        List<JSONObject> waiting = journal.sessions();
        if (!waiting.isEmpty()) {
            text(getString(R.string.open_workouts), 15, LIME);
            for (JSONObject s : waiting) {
                text(planName(s), 15, TEXT); text(getString(statusText(s)), 12, statusColor(s));
                String id = s.optString("sessionId");
                button(getString(R.string.open_workout), true, () -> { sessionId = id; go("session"); });
            }
        }
        JSONArray recent = journal.recent();
        for (int i = 0; recent != null && i < recent.length(); i++) {
            JSONObject r = recent.optJSONObject(i); if (r == null) continue;
            text(getString(R.string.recent_result, r.optString("name"), getString(resultText(r.optString("status")))), 12, MUTED);
        }
        JSONObject pack = journal.pack();
        text(getString(R.string.watch_plans), 15, LIME);
        if (pack == null) note(R.string.cache_missing);
        else if (!journal.packUsable()) note(R.string.cache_expired);
        else {
            JSONObject seed = pack.optJSONObject("active");
            boolean phoneBusy = snapshot != null && snapshot.optJSONObject("session") != null;
            // Poznámka: pri aktívnom tréningu na telefóne sa nový uložený štart nenabízá; ponúkne sa presné pokračovanie.
            boolean continuation = seed != null && journal.session(seed.optString("sessionId")) == null
                && (snapshot == null || (phoneBusy && seed.optString("sessionId").equals(snapshot.optJSONObject("session").optString("id"))));
            if (continuation) {
                JSONObject plan = seed.optJSONObject("plan");
                text(getString(R.string.continue_phone_workout, plan == null ? "" : plan.optString("name")), 14, TEXT);
                button(getString(R.string.continue_workout), true, this::continueLocal);
            }
            JSONArray plans = pack.optJSONArray("plans");
            boolean room = journal.outstanding() < JournalRules.MAX_OUTSTANDING;
            boolean can = room && !phoneBusy;
            for (int i = 0; plans != null && i < plans.length(); i++) {
                JSONObject plan = plans.optJSONObject(i); if (plan == null) continue;
                String id = plan.optString("planId");
                text(plan.optString("name"), 17, TEXT);
                text(getString(R.string.sets, JournalRules.totalSets(plan)), 13, MUTED);
                button(getString(R.string.start_on_watch, plan.optString("name")), can, () -> startLocal(id));
            }
            if (!room) note(R.string.start_refused);
            note(R.string.cached_note);
            if (pack.optBoolean("truncated")) note(R.string.cache_truncated);
        }
        if (snapshot != null) {
            text(getString(R.string.phone_plans), 15, LIME);
            note(R.string.phone_required);
            JSONObject session = snapshot.optJSONObject("session");
            if (session != null) {
                text(session.optString("planName"), 17, LIME);
                text(getString(R.string.session_progress, session.optInt("done"), session.optInt("total")), 15, TEXT);
                if (!session.optString("exerciseName").isEmpty()) text(session.optString("exerciseName"), 14, MUTED);
                note(R.string.session_active);
            } else {
                JSONArray plans = snapshot.optJSONArray("plans");
                if (plans == null || plans.length() == 0) note(R.string.no_plans);
                else for (int i = 0; i < plans.length(); i++) {
                    JSONObject plan = plans.optJSONObject(i);
                    if (plan == null) continue;
                    String id = plan.optString("id");
                    text(plan.optString("name"), 17, TEXT);
                    text(getString(R.string.sets, plan.optInt("sets")), 13, MUTED);
                    if (plan.optBoolean("recommended")) note(R.string.recommended);
                    button(getString(R.string.start_plan, plan.optString("name")), !link.busy(), () -> send("startWorkout", args("planId", id)));
                }
            }
            status();
        } else note(link.linkedGeneration() ? R.string.unavailable : R.string.unlinked_help);
    }
    private String number(Object value) {
        NumberFormat f = NumberFormat.getNumberInstance(); f.setMaximumFractionDigits(2);
        return f.format(((Number) value).doubleValue());
    }
    private String setLabel(int position, JSONObject set) {
        boolean weight = !set.isNull("weight") && set.opt("weight") instanceof Number;
        boolean reps = !set.isNull("reps") && set.opt("reps") instanceof Number;
        if (weight && reps) return getString(R.string.set_row_wr, position, number(set.opt("weight")), number(set.opt("reps")));
        if (reps) return getString(R.string.set_row_r, position, number(set.opt("reps")));
        return getString(R.string.set_row, position);
    }
    private Button setButton(LinearLayout parent, CharSequence label, boolean marked, boolean enabled, Runnable action) {
        Button b = styled((marked ? "\u2713 " : "") + label, enabled || marked, marked);
        b.setEnabled(enabled); b.setAlpha(enabled || marked ? 1f : .55f);
        LinearLayout.LayoutParams params = parent == column ? new LinearLayout.LayoutParams(-1, -2) : new LinearLayout.LayoutParams(0, -2, 1f);
        params.setMargins(dp(parent == column ? 0 : 2), dp(3), dp(parent == column ? 0 : 2), dp(3));
        parent.addView(b, params); b.setOnClickListener(v -> action.run()); return b;
    }
    private void toggle(String id, String key) {
        try { link.toggle(id, key); render(true); }
        catch (RuntimeException e) { failure(errorText(e)); render(true); }
    }
    private void session() {
        JSONObject s = link.journal().session(sessionId);
        if (s == null) { page = "workout"; workout(link.visible()); return; }
        boolean open = "open".equals(s.optString("state"));
        TextView name = text(planName(s), 19, LIME); name.setTypeface(null, Typeface.BOLD);
        text(getString(R.string.session_progress, WatchJournal.done(s), WatchJournal.totalKeys(s)), 15, TEXT);
        text(getString(statusText(s)), 12, statusColor(s));
        JSONObject plan = s.optJSONObject("plan"); JSONObject marks = s.optJSONObject("marks");
        JSONArray slots = plan == null ? null : plan.optJSONArray("slots");
        for (int i = 0; slots != null && i < slots.length(); i++) {
            JSONObject slot = slots.optJSONObject(i); if (slot == null) continue;
            boolean sided = !slot.isNull("sides");
            JSONArray sets = slot.optJSONArray("sets");
            TextView slotName = text(slot.optString("name"), 15, TEXT); slotName.setTypeface(null, Typeface.BOLD);
            for (int j = 0; sets != null && j < sets.length(); j++) {
                JSONObject set = sets.optJSONObject(j); if (set == null) continue;
                String label = setLabel(j + 1, set);
                if (!sided) {
                    String key = set.optString("setKey");
                    setButton(column, label, marks.has(key), open, () -> toggle(s.optString("sessionId"), key));
                } else {
                    JSONObject keys = set.optJSONObject("setKeys");
                    if (keys == null) continue;
                    text(label, 13, MUTED);
                    LinearLayout row = new LinearLayout(this); row.setOrientation(LinearLayout.HORIZONTAL);
                    column.addView(row, new LinearLayout.LayoutParams(-1, -2));
                    String left = keys.optString("L"), right = keys.optString("R");
                    setButton(row, getString(R.string.side_left), marks.has(left), open, () -> toggle(s.optString("sessionId"), left));
                    setButton(row, getString(R.string.side_right), marks.has(right), open, () -> toggle(s.optString("sessionId"), right));
                }
            }
        }
        if (open) {
            String id = s.optString("sessionId");
            boolean any = WatchJournal.done(s) > 0;
            if (any) button(getString(R.string.finish_workout), true, () -> new AlertDialog.Builder(this)
                .setTitle(R.string.finish_title).setMessage(R.string.finish_message).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.finish, (d, w) -> {
                    try { link.finishSession(id); go("workout"); } catch (RuntimeException e) { failure(errorText(e)); }
                }).show());
            button(getString(R.string.discard_workout), true, () -> new AlertDialog.Builder(this)
                .setTitle(R.string.discard_title).setMessage(R.string.discard_message).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.discard, (d, w) -> {
                    try { link.discardSession(id); go("workout"); } catch (RuntimeException e) { failure(errorText(e)); }
                }).show());
        } else if (s.optBoolean("review")) {
            // Prácu nikdy nemažeme potichu: používateľ ju môže zahodiť až po potvrdení.
            note(R.string.review_kept);
            String reviewId = s.optString("sessionId");
            // Prechodné chyby (plný zásobník, úložisko telefónu) sa po oprave samy odošlú znova; zahodenie sa neponúka.
            if (!WatchJournal.transientError(s.optString("error"))) button(getString(R.string.discard_workout), true, () -> new AlertDialog.Builder(this)
                .setTitle(R.string.discard_title).setMessage(R.string.discard_message).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.discard, (d, w) -> {
                    try { link.dropReview(reviewId); go("workout"); } catch (RuntimeException e) { failure(errorText(e)); }
                }).show());
        }
        // Vysvetlenia ostávajú dostupné, no pod ovládaním, aby sa prvé sety zmestili na prvú obrazovku.
        if (open && s.optBoolean("provisional") && s.optLong("ackSeq") == 0) note(R.string.status_provisional);
        if (!open && "discarded".equals(s.optString("state"))) note(R.string.discard_pending);
    }
    private void showPrivate(AlertDialog.Builder builder, String conversationId, EditText input) {
        dismissPrivate();
        AlertDialog dialog = builder.create();
        privateDialog = dialog; privateInput = input; privateChatId = conversationId;
        dialog.setOnDismissListener(d -> { if (privateDialog == dialog) clearPrivate(); });
        dialog.show();
    }
    private void clearPrivate() {
        if (privateInput != null) privateInput.setText("");
        privateInput = null; privateDialog = null; privateChatId = "";
    }
    private void dismissPrivate() {
        AlertDialog dialog = privateDialog; clearPrivate();
        if (dialog != null) dialog.dismiss();
    }
    /** Zatvorí dialóg odpovede, keď už neplatí čerstvé pripojenie, súhlas na správy, väzba ani možnosť odpovedať. */
    private void guardPrivate() {
        if (privateDialog == null) return;
        if (!ReplyGuard.allowed(link.messages(), privateChatId)) dismissPrivate();
    }

    /* ---------- správy: len pamäť, len online ---------- */
    private String unreadLabel() {
        JSONArray chats = link.messages(); int unread = 0;
        for (int i = 0; chats != null && i < chats.length(); i++) { JSONObject c = chats.optJSONObject(i); if (c != null) unread += c.optInt("unread"); }
        return unread > 0 ? getString(R.string.messages_unread, unread) : getString(R.string.messages);
    }
    private void messages() {
        title(R.string.messages);
        JSONArray chats = link.messages();
        if (chats == null) { note(R.string.messages_unavailable); return; }
        note(R.string.messages_note);
        if (chats.length() == 0) note(R.string.messages_empty);
        for (int i = 0; i < chats.length(); i++) {
            JSONObject chat = chats.optJSONObject(i); if (chat == null) continue;
            String id = chat.optString("conversationId");
            int unread = chat.optInt("unread");
            String label = unread > 0 ? chat.optString("name") + " \u00B7 " + getString(R.string.unread_count, unread) : chat.optString("name");
            button(label, true, () -> { chatId = id; go("chat"); });
            if (!chat.optString("last").isEmpty()) text(chat.optString("last"), 12, MUTED);
        }
    }
    private JSONObject findChat() {
        JSONArray chats = link.messages();
        for (int i = 0; chats != null && i < chats.length(); i++) {
            JSONObject chat = chats.optJSONObject(i);
            if (chat != null && chat.optString("conversationId").equals(chatId) && !chatId.isEmpty()) return chat;
        }
        return null;
    }
    private void chat() {
        JSONObject chat = findChat();
        if (chat == null) { chatId = ""; page = "messages"; messages(); return; }
        TextView name = text(chat.optString("name"), 19, LIME); name.setTypeface(null, Typeface.BOLD);
        if (!chat.optString("last").isEmpty()) text(chat.optString("last"), 14, TEXT);
        if (!chat.optBoolean("canSend")) { note(R.string.no_reply); return; }
        String id = chat.optString("conversationId"), who = chat.optString("name");
        boolean ready = !link.busy();
        int[] quick = {R.string.quick_ok, R.string.quick_thanks, R.string.quick_on_my_way, R.string.quick_later};
        for (int resource : quick) {
            String body = getString(resource);
            button(body, ready, () -> confirmReply(id, who, body));
        }
        button(getString(R.string.reply_write), ready, () -> {
            EditText input = new EditText(this); input.setHint(R.string.reply_hint);
            input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_FLAG_CAP_SENTENCES | InputType.TYPE_TEXT_FLAG_MULTI_LINE);
            input.setFilters(new InputFilter[]{new InputFilter.LengthFilter(WearProtocol.MAX_REPLY)});
            showPrivate(new AlertDialog.Builder(this).setTitle(R.string.reply_write).setView(input).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.send, (d, w) -> {
                    String body = input.getText().toString().trim();
                    if (!body.isEmpty()) confirmReply(id, who, body);
                }), id, input);
        });
        status();
    }
    private void confirmReply(String id, String who, String body) {
        showPrivate(new AlertDialog.Builder(this).setTitle(R.string.reply_confirm_title)
            .setMessage(getString(R.string.reply_confirm_message, body, who)).setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.send, (d, w) -> { link.submitMessage(id, body); render(true); }), id, null);
    }

    private void phoneTimer(JSONObject snapshot) {
        title(R.string.phone_timer);
        if (!requirePhone(snapshot)) return;
        JSONObject rest = snapshot.optJSONObject("rest");
        if (rest == null || rest.optBoolean("done")) {
            note(R.string.timer_empty);
            for (int duration : new int[]{60, 90, 120}) button(getString(R.string.start_seconds, duration), !link.busy(), () -> send("restStart", args("seconds", duration)));
        } else {
            countdown = text("", 48, LIME);
            if (rest.optLong("pausedLeftMs") > 0) note(R.string.paused);
            button(getString(R.string.add_time), !link.busy(), () -> send("restAdd", args("seconds", 15)));
            button(getString(R.string.stop), !link.busy(), () -> new AlertDialog.Builder(this)
                .setTitle(R.string.stop).setMessage(R.string.phone_timer_help)
                .setNegativeButton(R.string.cancel, null).setPositiveButton(R.string.stop, (d, w) -> send("restStop", new JSONObject())).show());
        }
        status();
    }
    private interface TimerAction { void run() throws Exception; }
    private void mutate(TimerAction action) {
        try { action.run(); render(true); } catch (Exception e) { failure(R.string.timer_error); }
    }
    private void localTimer() {
        title(R.string.watch_only);
        JSONObject state = timer.state(); long left = timer.remaining(); timerWasLive = left > 0;
        if (left > 0) {
            countdown = text("", 48, LIME);
            if (state.optBoolean("paused")) note(R.string.paused);
            button(state.optBoolean("paused") ? R.string.resume : R.string.pause,
                () -> mutate(() -> { if (timer.state().optBoolean("paused")) timer.resume(); else timer.pause(); }));
            button(R.string.add_time, () -> mutate(() -> timer.add()));
            button(R.string.stop, () -> new AlertDialog.Builder(this).setTitle(R.string.stop_timer_title)
                .setMessage(R.string.stop_timer_message).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.stop, (d, w) -> mutate(() -> timer.stop())).show());
        } else {
            note(state.optBoolean("done") ? R.string.rest_done : R.string.timer_empty);
            for (int duration : new int[]{60, 90, 120}) button(getString(R.string.start_seconds, duration), true, () -> mutate(() -> timer.start(duration)));
        }
        if (state.optBoolean("restored")) note(R.string.timer_restored);
        if (state.optBoolean("invalid")) note(R.string.timer_invalid);
        if (!timer.exact()) note(R.string.alerts_late);
        button(R.string.timer_options, () -> go("timer-settings"));
    }
    private void timerPermissions() {
        title(R.string.timer_options);
        note(timer.exact() ? R.string.exact_allowed : R.string.exact_denied);
        if (!timer.exact()) button(R.string.exact_settings, () -> {
            if (Build.VERSION.SDK_INT >= 31) openSettings(new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getPackageName())));
        });
        note(timer.notifications() ? R.string.notification_allowed : R.string.notification_denied);
        if (!timer.notifications()) {
            if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != android.content.pm.PackageManager.PERMISSION_GRANTED)
                button(R.string.allow_notifications, () -> requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 1));
            button(R.string.notification_settings, () -> openSettings(new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())));
        }
    }
    private void updateClocks() {
        if (commandStatus != null) commandStatus.setText(link.outcome());
        if (countdown == null) return;
        long left = 0;
        if (page.equals("local")) {
            left = timer.remaining();
            if (timerWasLive && left <= 0) { timerWasLive = false; render(true); return; }
        } else if (page.equals("phone")) {
            JSONObject s = link.visible(), rest = s == null ? null : s.optJSONObject("rest");
            if (rest != null && !rest.optBoolean("done")) left = rest.optLong("pausedLeftMs") > 0
                ? rest.optLong("pausedLeftMs") : Math.max(0, rest.optLong("endAt") - System.currentTimeMillis());
        }
        long seconds = (left + 999) / 1000;
        if (seconds == clockSeconds) return;
        clockSeconds = seconds;
        int pos = clockDigits.length;
        clockDigits[--pos] = (char) (zeroDigit + seconds % 10);
        clockDigits[--pos] = (char) (zeroDigit + (seconds / 10) % 6);
        clockDigits[--pos] = ':';
        long minutes = seconds / 60;
        do {
            clockDigits[--pos] = (char) (zeroDigit + minutes % 10);
            minutes /= 10;
        } while (minutes > 0);
        countdown.setText(clockDigits, pos, clockDigits.length - pos);
    }
    private void calendar(JSONObject snapshot) {
        title(R.string.calendar); note(R.string.calendar_read_only);
        if (!requirePhone(snapshot)) return;
        JSONArray days = snapshot.optJSONArray("calendar");
        if (days == null || days.length() == 0) { note(R.string.calendar_empty); return; }
        for (int i = 0; i < days.length(); i++) {
            JSONObject day = days.optJSONObject(i); if (day == null) continue;
            text(day.optString("date"), 16, LIME); text(day.optString("title"), 15, TEXT);
            note(day.optString("status").equals("completed") ? R.string.completed : R.string.planned);
        }
    }
    private void linking(JSONObject snapshot) {
        title(R.string.connect_phone);
        if (snapshot != null) text(getString(R.string.linked_to, snapshot.optJSONObject("binding").optString("label")), 15, LIME);
        else note(link.linkedGeneration() ? R.string.unavailable : R.string.not_linked);
        note(R.string.unlinked_help);
        if (link.linkedGeneration() || link.journal().unreadable()) button(R.string.unlink, () -> {
            int pending = link.unsynced();
            String message = getString(R.string.unlink_message);
            if (pending > 0) message = message + "\n\n" + getString(R.string.unlink_unsynced_message, pending);
            new AlertDialog.Builder(this).setTitle(R.string.unlink_title)
                .setMessage(message).setNegativeButton(R.string.cancel, null)
                .setPositiveButton(R.string.unlink, (d, w) -> {
                    try { link.unlink(); render(false); } catch (Exception e) { column.removeAllViews(); note(R.string.unlink_error); button(R.string.back, () -> go("home")); }
                }).show();
        });
    }
    private void openSettings(Intent intent) {
        try { startActivity(intent); } catch (Exception e) { failure(R.string.permission_unavailable); }
    }
    private void failure(int message) { new AlertDialog.Builder(this).setMessage(message).setPositiveButton(android.R.string.ok, null).show(); }
}
