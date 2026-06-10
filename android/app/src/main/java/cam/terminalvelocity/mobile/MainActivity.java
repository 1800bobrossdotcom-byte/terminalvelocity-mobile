package cam.terminalvelocity.mobile;

import android.content.Context;
import android.media.AudioManager;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.WindowManager;
import android.webkit.WebSettings;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;

/**
 * Prevents Android from putting the system into MODE_IN_COMMUNICATION
 * once the WebView opens the microphone (which downsamples speaker
 * output to a tinny voice profile).
 *
 * Also disables the WebView's HTTP cache so reinstalled APKs always
 * load fresh JS/CSS instead of leftover bytes from the previous build.
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

        try {
            WebView wv = (WebView) this.bridge.getWebView();
            if (wv != null) {
                WebSettings s = wv.getSettings();
                s.setCacheMode(WebSettings.LOAD_NO_CACHE);
                s.setDomStorageEnabled(true);
                s.setMediaPlaybackRequiresUserGesture(false);
                wv.clearCache(true);
            }
        } catch (Throwable ignored) {}
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
