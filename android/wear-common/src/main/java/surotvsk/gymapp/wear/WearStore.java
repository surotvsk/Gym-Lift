package surotvsk.gymapp.wear;

import org.json.JSONObject;

/** Atómové úložisko jedného JSON dokumentu. Zápis buď uspeje celý, alebo vyhodí výnimku. */
public interface WearStore {
    JSONObject read();
    void write(JSONObject value);
}
