package com.keepvocab.app;

import static org.junit.Assert.*;

import android.app.NotificationManager;
import android.app.NotificationChannel;
import android.app.UiAutomation;
import android.content.Context;
import android.os.Build;
import android.os.ParcelFileDescriptor;
import android.service.notification.StatusBarNotification;
import android.view.accessibility.AccessibilityNodeInfo;
import android.webkit.WebView;
import androidx.lifecycle.Lifecycle;
import androidx.test.core.app.ActivityScenario;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.FileInputStream;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;
import org.json.JSONObject;
import org.junit.Test;
import org.junit.runner.RunWith;

/** Exercises the packaged JavaScript and Capacitor plugin against Android itself. */
@RunWith(AndroidJUnit4.class)
public class AndroidRemindersTest {
    private static final String PACKAGE = "com.keepvocab.app";
    private static final String CHANNEL = "keepvocab-practice";
    private WebView webView;

    private void shell(String command) throws Exception {
        try (ParcelFileDescriptor descriptor = InstrumentationRegistry.getInstrumentation()
                .getUiAutomation().executeShellCommand(command);
             FileInputStream input = new FileInputStream(descriptor.getFileDescriptor())) {
            byte[] buffer = new byte[4096];
            while (input.read(buffer) != -1) { /* Drain command output before continuing. */ }
        }
    }

    private String evaluate(String source) throws Exception {
        CountDownLatch latch = new CountDownLatch(1);
        AtomicReference<String> result = new AtomicReference<>();
        InstrumentationRegistry.getInstrumentation().runOnMainSync(() ->
            webView.evaluateJavascript(source, value -> { result.set(value); latch.countDown(); }));
        assertTrue("WebView response timed out", latch.await(10, TimeUnit.SECONDS));
        return result.get();
    }

    private void startAsync(String source) throws Exception {
        evaluate("window.reminderTestResult=null;(async()=>{try {window.reminderTestResult="
            + "{ok:true,value:await (async()=>{" + source + "})()};}catch(e){"
            + "window.reminderTestResult={ok:false,error:String(e.message||e)};}})();true");
    }

    private JSONObject finishAsync() throws Exception {
        long deadline = System.currentTimeMillis() + 20000;
        while (System.currentTimeMillis() < deadline) {
            String result = evaluate("window.reminderTestResult");
            if (!"null".equals(result)) {
                JSONObject json = new JSONObject(result);
                assertTrue(json.optString("error"), json.getBoolean("ok"));
                return json.getJSONObject("value");
            }
            Thread.sleep(100);
        }
        throw new AssertionError("Native notification call timed out");
    }

    private JSONObject runAsync(String source) throws Exception {
        startAsync(source);
        return finishAsync();
    }

    private boolean clickAllow(AccessibilityNodeInfo node) {
        if (node == null) return false;
        String id = node.getViewIdResourceName();
        CharSequence text = node.getText();
        if ((id != null && id.endsWith(":id/permission_allow_button"))
                || (text != null && text.toString().equalsIgnoreCase("Allow"))) {
            return node.performAction(AccessibilityNodeInfo.ACTION_CLICK);
        }
        for (int i = 0; i < node.getChildCount(); i++) {
            if (clickAllow(node.getChild(i))) return true;
        }
        return false;
    }

    private void allowNotificationPrompt() throws Exception {
        UiAutomation automation = InstrumentationRegistry.getInstrumentation().getUiAutomation();
        long deadline = System.currentTimeMillis() + 10000;
        while (System.currentTimeMillis() < deadline) {
            if (clickAllow(automation.getRootInActiveWindow())) return;
            Thread.sleep(100);
        }
        throw new AssertionError("Android notification permission prompt was not shown");
    }

    private boolean delivered(NotificationManager manager, int id) {
        for (StatusBarNotification item : manager.getActiveNotifications()) {
            if (item.getId() == id) return true;
        }
        return false;
    }

    @Test
    public void permissionsRoutineAndBackgroundDelivery() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals(PACKAGE, context.getPackageName());
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        // Run on a fresh dedicated emulator install. Revoking permissions from
        // inside instrumentation can kill the test process along with the app.
        try (ActivityScenario<MainActivity> scenario = ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity -> webView = activity.getBridge().getWebView());
            long deadline = System.currentTimeMillis() + 30000;
            while (!"true".equals(evaluate("!!document.querySelector('#settings-routine')"))) {
                if (System.currentTimeMillis() >= deadline) throw new AssertionError("Packaged app did not load");
                evaluate("location.hash='settings'");
                Thread.sleep(200);
            }
            runAsync("window.reminders=await import(new URL('./js/services/reminderService.js',location.href).href);"
                + "return {platform:Capacitor.getPlatform(),available:Capacitor.isPluginAvailable('LocalNotifications')};");
            if (Build.VERSION.SDK_INT >= 33) {
                assertEquals("permission-required", runAsync("return await reminders.getReminderStatus();").getString("status"));
                startAsync("return await reminders.sendTestReminder();");
                allowNotificationPrompt();
                assertEquals("test-sent", finishAsync().getString("status"));
            } else {
                assertEquals("test-sent", runAsync("return await reminders.sendTestReminder();").getString("status"));
            }
            assertTrue("Immediate notification must be visible to Android", delivered(manager, 73003));
            if (Build.VERSION.SDK_INT >= 26) {
                assertEquals(NotificationManager.IMPORTANCE_HIGH, manager.getNotificationChannel(CHANNEL).getImportance());
                assertNotNull(manager.getNotificationChannel(CHANNEL).getSound());
            }

            runAsync("const {driveSync}=await import(new URL('./js/services/driveSync.js?v=1602',location.href).href);"
                + "driveSync.updateSettings({reminderEnabled:true});return {};");

            JSONObject approximate = runAsync("return await reminders.scheduleDailyReminder(reminders.buildReminderSchedule());");
            assertEquals("scheduled", approximate.getString("status"));
            JSONObject pending = runAsync("return await Capacitor.Plugins.LocalNotifications.getPending();");
            assertEquals(7, pending.getJSONArray("notifications").length());
            if (Build.VERSION.SDK_INT >= 31) {
                assertEquals("denied", approximate.getString("exactAlarm"));
                assertFalse(pending.getJSONArray("notifications").getJSONObject(0).getBoolean("isExactNotification"));
                shell("appops set " + PACKAGE + " SCHEDULE_EXACT_ALARM allow");
            }
            JSONObject precise = runAsync("return await reminders.scheduleDailyReminder(reminders.buildReminderSchedule());");
            assertEquals("granted", precise.getString("exactAlarm"));
            assertEquals(7, runAsync("return await reminders.getReminderStatus();").getInt("pendingCount"));

            assertEquals("test-scheduled", runAsync("return await reminders.sendTestReminder({delaySeconds:3});").getString("status"));
            // Stops/pauses the actual Activity and WebView; no JavaScript timers can deliver this notification.
            scenario.moveToState(Lifecycle.State.CREATED);
            deadline = System.currentTimeMillis() + 20000;
            while (!delivered(manager, 73003) && System.currentTimeMillis() < deadline) Thread.sleep(100);
            assertTrue("AlarmManager must deliver while the WebView is stopped", delivered(manager, 73003));
            for (StatusBarNotification item : manager.getActiveNotifications()) {
                if (item.getId() == 73003) item.getNotification().contentIntent.send();
            }
            scenario.moveToState(Lifecycle.State.RESUMED);
            deadline = System.currentTimeMillis() + 10000;
            while (!"\"#review\"".equals(evaluate("location.hash"))) {
                if (System.currentTimeMillis() >= deadline) throw new AssertionError("Notification tap did not open Practice");
                Thread.sleep(100);
            }
            assertEquals(7, runAsync("return await reminders.getReminderStatus();").getInt("pendingCount"));
            runAsync("const {driveSync}=await import(new URL('./js/services/driveSync.js?v=1602',location.href).href);"
                + "driveSync.updateSettings({reminderEnabled:false});"
                + "await reminders.cancelDailyReminder();return await reminders.getReminderStatus();");
            assertEquals(0, runAsync("return await reminders.getReminderStatus();").getInt("pendingCount"));
            assertEquals(0, runAsync("return await Capacitor.Plugins.LocalNotifications.getPending();")
                .getJSONArray("notifications").length());
            if (Build.VERSION.SDK_INT >= 26) {
                manager.createNotificationChannel(new NotificationChannel(CHANNEL, "Practice reminders", NotificationManager.IMPORTANCE_NONE));
                assertEquals("channel-blocked", runAsync("return await reminders.getReminderStatus();").getString("status"));
                assertEquals("channel-blocked", runAsync("return await reminders.scheduleDailyReminder(reminders.buildReminderSchedule());")
                    .getString("status"));
            }
            manager.cancelAll();
        }
    }
}
