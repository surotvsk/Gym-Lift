package surotvsk.gymapp.wear;

import com.google.android.gms.wearable.MessageEvent;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.WearableListenerService;

public final class WatchListenerService extends WearableListenerService {
    @Override public void onMessageReceived(MessageEvent event) {
        String path = event.getPath();
        if (WearProtocol.SNAPSHOT.equals(path)) WatchLink.get(this).snapshotMessage(event.getSourceNodeId(), event.getData());
        else if (WearProtocol.ACK.equals(path)) WatchLink.get(this).ack(event.getSourceNodeId(), event.getData());
        else if (WearProtocol.PACK.equals(path)) WatchLink.get(this).packMessage(event.getSourceNodeId(), event.getData());
        else if (WearProtocol.JOURNAL_ACK.equals(path)) WatchLink.get(this).journalAck(event.getSourceNodeId(), event.getData());
        else if (WearProtocol.UNLINK.equals(path)) WatchLink.get(this).unlinkAck(event.getSourceNodeId(), event.getData());
    }
    @Override public void onPeerDisconnected(Node node) { WatchLink.get(this).disconnected(node.getId()); }
    @Override public void onPeerConnected(Node node) { WatchLink.get(this).refresh(); }
}
