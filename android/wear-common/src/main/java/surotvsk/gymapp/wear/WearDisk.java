package surotvsk.gymapp.wear;

import android.content.Context;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;

/** Atómový lokálny denník vylúčený zo záloh. Volajúci serializuje prístup. */
public final class WearDisk implements WearStore {
    private final AtomicFile file;
    public WearDisk(Context c, String name) { file = new AtomicFile(new File(c.getNoBackupFilesDir(), name)); }
    public JSONObject read() {
        if (!file.getBaseFile().exists()) return new JSONObject();
        try { return new JSONObject(new String(file.readFully(), StandardCharsets.UTF_8)); }
        catch (Exception e) { throw new IllegalStateException("wear_storage_read", e); }
    }
    public void write(JSONObject value) {
        FileOutputStream out = null;
        try {
            out = file.startWrite(); out.write(WearProtocol.bytes(value)); file.finishWrite(out);
        } catch (Exception e) {
            if (out != null) file.failWrite(out);
            throw new IllegalStateException("wear_storage_write", e);
        }
    }
}
