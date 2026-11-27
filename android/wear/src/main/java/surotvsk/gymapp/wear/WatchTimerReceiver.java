package surotvsk.gymapp.wear;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class WatchTimerReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        WatchTimer timer = WatchTimer.get(context);
        if ("surotvsk.gymapp.wear.TIMER".equals(intent.getAction())) timer.alarm(intent.getStringExtra("id") == null ? "" : intent.getStringExtra("id"));
        else timer.restore();
    }
}
