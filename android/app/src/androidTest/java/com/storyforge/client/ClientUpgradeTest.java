package com.storyforge.client;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import android.os.SystemClock;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.json.JSONTokener;
import org.junit.Assume;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Two signed release APKs, installed with adb install -r between separate invocations. */
@RunWith(AndroidJUnit4.class)
public class ClientUpgradeTest {
    // Chromium batches localStorage commits for five seconds. Keep the synthetic
    // write stable across that window before ending its process. This is not a
    // durability assertion: baseline/restore/restart must still read it after force-stop.
    private static final long FIXTURE_STORAGE_SETTLE_MILLIS = 6000;
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView evaluation timed out", done.await(15, TimeUnit.SECONDS));
        return result.get();
    }
    private void awaitTrue(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        for (int i = 0; i < 180; i++) {
            if ("true".equals(evaluate(scenario, script))) return;
            Thread.sleep(500);
        }
        fail("Client did not reach expected state: " + script);
    }
    private void awaitStableFixtureStorage(ActivityScenario<MainActivity> scenario) throws Exception {
        assertEquals("true", evaluate(scenario, "window.__nativeUpgradeStableStorage = localStorage.getItem('storyforge-native-upgrade-fixture'); window.__nativeUpgradeStableStorage !== null"));
        long deadline = SystemClock.elapsedRealtime() + FIXTURE_STORAGE_SETTLE_MILLIS;
        do {
            Thread.sleep(250);
            assertEquals("Synthetic fixture changed before process shutdown", "true", evaluate(scenario, "localStorage.getItem('storyforge-native-upgrade-fixture') === window.__nativeUpgradeStableStorage"));
        } while (SystemClock.elapsedRealtime() < deadline);
    }
    @Test public void productionWorkspaceSurvivesSignedPackageReplacement() throws Exception {
        String phase = InstrumentationRegistry.getArguments().getString("phase");
        Assume.assumeTrue(phase != null);
        assertTrue(phase.equals("seed") || phase.equals("baseline") || phase.equals("restore") || phase.equals("restart"));
        String expectedVersion = InstrumentationRegistry.getArguments().getString("expectedVersion");
        assertNotNull("Pass the expected installed version for this phase", expectedVersion);
        android.content.Context target = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(expectedVersion, target.getPackageManager().getPackageInfo(target.getPackageName(), 0).versionName);
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            awaitTrue(scenario, "!!document.querySelector('#root main, #root button')");
            assertEquals("\"https://localhost\"", evaluate(scenario, "location.origin"));
            String fixture;
            String fixtureName = phase.equals("seed") || phase.equals("baseline") ? "native-upgrade-old.js" : "native-upgrade.js";
            try (java.io.InputStream stream = InstrumentationRegistry.getInstrumentation().getContext().getAssets().open(fixtureName)) {
                fixture = new String(stream.readAllBytes(), StandardCharsets.UTF_8);
            }
            evaluate(scenario, "window.__nativeFixtureParts = []; true");
            for (int i = 0; i < fixture.length(); i += 30000) {
                evaluate(scenario, "window.__nativeFixtureParts.push(" + JSONObject.quote(fixture.substring(i, Math.min(i + 30000, fixture.length()))) + "); true");
            }
            evaluate(scenario, "(0,eval)(window.__nativeFixtureParts.join('')); window.__nativeFixtureParts = []; true");
            assertEquals(JSONObject.quote(expectedVersion), evaluate(scenario, "window.__nativeUpgradeSource.version"));
            java.io.File backupFile = new java.io.File(InstrumentationRegistry.getInstrumentation().getTargetContext().getFilesDir(), "native-upgrade-test/backup.json");
            String operation = phase.equals("seed") ? "seed()" : "verify(false, undefined, " + phase.equals("restart") + ")";
            if (phase.equals("restore")) {
                String backup = new String(java.nio.file.Files.readAllBytes(backupFile.toPath()), StandardCharsets.UTF_8);
                operation = "verify(true, JSON.parse(" + JSONObject.quote(backup) + "))";
            }
            evaluate(scenario, "window.__nativeUpgradeResult = null; window.__nativeUpgrade." + operation + ".then(value => {window.__nativeUpgradeResult = {ok:true,value};}).catch(error => {window.__nativeUpgradeResult = {ok:false,error:String(error)};}); true");
            awaitTrue(scenario, "window.__nativeUpgradeResult !== null");
            assertEquals(evaluate(scenario, "JSON.stringify(window.__nativeUpgradeResult)"), "true", evaluate(scenario, "window.__nativeUpgradeResult.ok"));
            if (phase.equals("seed")) {
                String backup = (String) new JSONTokener(evaluate(scenario, "JSON.stringify(window.__nativeUpgradeResult.value.backup)")).nextValue();
                java.nio.file.Files.createDirectories(backupFile.getParentFile().toPath());
                java.nio.file.Files.write(backupFile.toPath(), backup.getBytes(StandardCharsets.UTF_8));
            }
            if (phase.equals("seed") || phase.equals("restore")) awaitStableFixtureStorage(scenario);
        }
    }
}
