package surotvsk.gymapp;

import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import androidx.lifecycle.Lifecycle;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.Node;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONObject;
import surotvsk.gymapp.wear.WearProtocol;
import java.util.List;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "GymWear")
public class GymWearPlugin extends Plugin {
    private volatile boolean foreground;
    @Override public void load() {
        foreground = getActivity() != null && getActivity().getLifecycle().getCurrentState().isAtLeast(Lifecycle.State.RESUMED);
        WearPhone.IO.execute(() -> WearPhone.get(getContext()).attach(this));
    }
    @Override protected void handleOnResume() { foreground = true; }
    @Override protected void handleOnPause() { foreground = false; }
    @Override protected void handleOnDestroy() { foreground = false; }
    private interface Work { JSObject run(WearPhone phone) throws Exception; }
    private void run(PluginCall call, Work work) {
        WearPhone.IO.execute(() -> {
            try { call.resolve(work.run(WearPhone.get(getContext()))); }
            catch (Exception e) { call.reject("GymWear: " + e.getMessage(), "WEAR_NATIVE", e); }
        });
    }
    @PluginMethod public void status(PluginCall call) {
        run(call, phone -> {
            List<Node> nodes = Tasks.await(Wearable.getNodeClient(getContext()).getConnectedNodes(), 5, TimeUnit.SECONDS);
            JSArray output = new JSArray();
            for (Node node : nodes) output.put(new JSObject().put("id", node.getId()).put("name", node.getDisplayName()));
            JSObject result = new JSObject().put("nodes", output);
            result.put("configuration", phone.configuration() == null ? JSONObject.NULL : new JSONObject(phone.configuration().toString()));
            return result;
        });
    }
    @PluginMethod public void configure(PluginCall call) {
        run(call, phone -> {
            JSONObject c = call.getObject("configuration");
            WearProtocol.require(c != null, "configuration_required"); WearProtocol.configuration(c);
            if (c.getBoolean("enabled")) {
                List<Node> nodes = Tasks.await(Wearable.getNodeClient(getContext()).getConnectedNodes(), 5, TimeUnit.SECONDS);
                boolean exists = false;
                for (Node node : nodes) if (node.getId().equals(c.getString("peer"))) exists = true;
                WearProtocol.require(exists, "peer_not_connected");
            }
            phone.configure(c); return new JSObject();
        });
    }
    @PluginMethod public void publish(PluginCall call) {
        run(call, phone -> {
            JSONObject snapshot = call.getObject("snapshot");
            WearProtocol.require(snapshot != null, "snapshot_required");
            phone.publish(snapshot); return new JSObject();
        });
    }
    @PluginMethod public void publishPack(PluginCall call) {
        run(call, phone -> {
            JSONObject pack = call.getObject("pack"), templates = call.getObject("templates");
            WearProtocol.require(pack != null && templates != null, "pack_required");
            phone.publishPack(pack, templates); return new JSObject();
        });
    }
    @PluginMethod public void drain(PluginCall call) {
        run(call, phone -> {
            // Najprv rozsah zásobníka; zlyhanie zásobníka nesmie zastaviť doručenie príkazov (len sa nahlási kódom).
            Object journals = new JSArray(); String journalsError = null;
            try { journals = phone.journals(); } catch (Exception e) { journalsError = e.getMessage(); }
            JSObject out = new JSObject().put("commands", phone.drain()).put("journals", journals);
            if (journalsError != null) out.put("journalsError", journalsError);
            return out;
        });
    }
    @PluginMethod public void journalResult(PluginCall call) {
        run(call, phone -> {
            JSONObject result = new JSONObject(call.getData().toString());
            phone.journalResult(result); return new JSObject();
        });
    }
    @PluginMethod public void validate(PluginCall call) {
        run(call, phone -> {
            phone.validate(required(call, "nodeId"), required(call, "id"), required(call, "epoch"), required(call, "workspace"));
            return new JSObject().put("valid", true);
        });
    }
    @PluginMethod public void ack(PluginCall call) {
        run(call, phone -> {
            JSONObject result = call.getObject("result");
            WearProtocol.require(result != null, "result_required");
            phone.ack(required(call, "nodeId"), required(call, "id"), result); return new JSObject();
        });
    }
    private String required(PluginCall call, String key) throws Exception {
        String value = call.getString(key);
        WearProtocol.require(value != null && !value.isEmpty(), key); return value;
    }
    void commandEvent(JSONObject event) throws Exception {
        if (foreground) notifyListeners("wearCommand", new JSObject(event.toString()));
    }
    boolean isForeground() { return foreground; }
    /** Signál bez obsahu: JS si denník vyžiada cez drain(). */
    void journalEvent() {
        if (foreground) notifyListeners("wearJournal", new JSObject());
    }
    void unlinkEvent(JSONObject event) throws Exception {
        if (foreground) notifyListeners("wearUnlinked", new JSObject(event.toString()));
    }
}
