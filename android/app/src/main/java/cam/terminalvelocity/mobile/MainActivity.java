package cam.terminalvelocity.mobile;

import android.content.Context;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;

import com.getcapacitor.BridgeActivity;

/**
 * Prevents Android from putting the system into MODE_IN_COMMUNICATION
 * once the WebView opens the microphone. That mode downsamples speaker
 * output to a narrow voice profile and is the reason mic-fed audio
 * sources (e.g. Spotify on the same phone) sound tinny / crunchy while
 * the visualizer is running.
 */
public class MainActivity extends BridgeActivity {

    private final Handler audioModeHandler = new Handler(Looper.getMainLooper());
    private final Runnable enforceNormalMode = new Runnable() {
        @Override public void run() {
            try {
                AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
                if (am != null && am.getMode() != AudioManager.MODE_NORMAL) {
                    am.setMode(AudioManager.MODE_NORMAL);
                }
                if (am != null && am.isSpeakerphoneOn()) {
                    am.setSpeakerphoneOn(false);
                }
            } catch (Throwable ignored) {}
            audioModeHandler.postDelayed(this, 750);
        }
    };

    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setVolumeControlStream(AudioManager.STREAM_MUSIC);
    }

    @Override
    public void onResume() {
        super.onResume();
        audioModeHandler.removeCallbacks(enforceNormalMode);
        audioModeHandler.post(enforceNormalMode);
    }

    @Override
    public void onPause() {
        audioModeHandler.removeCallbacks(enforceNormalMode);
        super.onPause();
    }
}
