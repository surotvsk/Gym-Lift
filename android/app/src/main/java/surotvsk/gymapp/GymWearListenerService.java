package surotvsk.gymapp;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.WearableListenerService;
import surotvsk.gymapp.wear.WearProtocol;

public final class GymWearListenerService extends WearableListenerService {
    @Override public void onMessageReceived(MessageEvent event) {
        String path = event.getPath();
        if (!WearProtocol.COMMAND.equals(path) && !WearProtocol.UNLINK.equals(path)
            && !WearProtocol.JOURNAL.equals(path) && !WearProtocol.PACK_REQUEST.equals(path)) return;
        String node = event.getSourceNodeId(); byte[] payload = event.getData();
        WearPhone.IO.execute(() -> WearPhone.get(getApplicationContext()).receive(node, path, payload));
    }
    /** Pripojenie uzla: odvolané hodinky dostanú čakajúci náhrobok aj bez toho, aby samy niečo poslali. */
    @Override public void onPeerConnected(Node node) {
        String id = node.getId();
        WearPhone.IO.execute(() -> WearPhone.get(getApplicationContext()).peerConnected(id));
    }
}
