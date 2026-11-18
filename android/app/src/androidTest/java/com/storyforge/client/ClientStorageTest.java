package com.storyforge.client;

import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

@RunWith(AndroidJUnit4.class)
public class ClientStorageTest {
    private String evaluate(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        AtomicReference<String> result = new AtomicReference<>();
        CountDownLatch done = new CountDownLatch(1);
        scenario.onActivity(activity -> activity.getBridge().getWebView().evaluateJavascript(script, value -> { result.set(value); done.countDown(); }));
        assertTrue("WebView evaluation timed out", done.await(10, TimeUnit.SECONDS));
        return result.get();
    }
    private void awaitTrue(ActivityScenario<MainActivity> scenario, String script) throws Exception {
        for (int i = 0; i < 120; i++) {
            if ("true".equals(evaluate(scenario, script))) return;
            Thread.sleep(500);
        }
        fail("Client did not reach expected state: " + script);
    }
    private void ready(ActivityScenario<MainActivity> scenario) throws Exception {
        awaitTrue(scenario, "!!document.querySelector('#root button')");
        assertEquals("\"https://localhost\"", evaluate(scenario, "location.origin"));
        assertEquals("false", evaluate(scenario, "document.body.innerText.includes('StoryForge 无法启动')"));
        assertEquals("true", evaluate(scenario, "Capacitor.isPluginAvailable('StoryForgeHttp') && Capacitor.isPluginAvailable('ClientUpdate') && Capacitor.isPluginAvailable('StoryForgeFiles')"));
    }
    @Test public void bundledAppBootsAndRetainsLocalStorageAndDatabaseAcrossWindows() throws Exception {
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            evaluate(scenario, "localStorage.removeItem('storyforge-client-agreement-v1'); window.__consentReloadPending = true; location.reload(); true");
            awaitTrue(scenario, "!window.__consentReloadPending && !!document.querySelector('#root button')");
            assertEquals("true", evaluate(scenario, "!Array.from(document.querySelectorAll('button')).some(b => b.textContent === '同意协议并继续')"));
            assertEquals("true", evaluate(scenario, "localStorage.getItem('storyforge-client-agreement-v1') === null"));
            assertEquals("true", evaluate(scenario, "JSON.parse(localStorage.getItem('storyforge-client-observability-v1'))?.analytics !== true && JSON.parse(localStorage.getItem('storyforge-client-observability-v1'))?.errors !== true"));
            evaluate(scenario, "localStorage.setItem('native-client-probe', 'preserved'); window.__probe = false; var r = indexedDB.open('native-client-probe', 1); r.onupgradeneeded = () => r.result.createObjectStore('values'); r.onsuccess = () => { var t = r.result.transaction('values', 'readwrite'); t.objectStore('values').put('manuscript-probe', 'sample'); t.oncomplete = () => { r.result.close(); window.__probe = true; }; }; true");
            awaitTrue(scenario, "window.__probe === true");
            evaluate(scenario, "window.__blocked = false; fetch('http://example.com/v1').catch(() => { window.__blocked = true; }); true");
            awaitTrue(scenario, "window.__blocked === true");
        }
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            ready(scenario);
            assertEquals("true", evaluate(scenario, "localStorage.getItem('storyforge-client-agreement-v1') === null"));
            assertEquals("\"preserved\"", evaluate(scenario, "localStorage.getItem('native-client-probe')"));
            evaluate(scenario, "window.__read = null; var r = indexedDB.open('native-client-probe', 1); r.onsuccess = () => { var q = r.result.transaction('values').objectStore('values').get('sample'); q.onsuccess = () => { window.__read = q.result; r.result.close(); }; }; true");
            awaitTrue(scenario, "window.__read === 'manuscript-probe'");
        }
    }
}
