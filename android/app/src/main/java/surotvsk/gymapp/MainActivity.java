package surotvsk.gymapp;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GymHealthPlugin.class);   // Health Connect (vlastný plugin v appke)
        super.onCreate(savedInstanceState);
    }
}
