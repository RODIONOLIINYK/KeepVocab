package com.keepvocab.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.UserManager;
import com.capacitorjs.plugins.localnotifications.LocalNotification;
import com.capacitorjs.plugins.localnotifications.LocalNotificationManager;
import com.capacitorjs.plugins.localnotifications.LocalNotificationSchedule;
import com.capacitorjs.plugins.localnotifications.NotificationStorage;
import com.getcapacitor.CapConfig;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.Date;
import java.util.List;

/**
 * Restores and catches up KeepVocab practice/streak notifications across
 * APK self-updates (MY_PACKAGE_REPLACED), device reboots, time/timezone changes,
 * and exact-alarm permission changes.
 */
public class KeepVocabReminderReceiver extends BroadcastReceiver {
    public static final String REMINDER_CHANNEL_ID = "keepvocab-practice";
    private static final long SAME_DAY_CATCH_UP_WINDOW_MS = 6L * 60L * 60L * 1000L;

    public static void ensureReminderChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(REMINDER_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            REMINDER_CHANNEL_ID,
            "Practice reminders",
            NotificationManager.IMPORTANCE_HIGH
        );
        channel.setDescription("Daily vocabulary practice and streak protection");
        channel.enableVibration(true);
        channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        manager.createNotificationChannel(channel);
    }

    public static void restoreScheduledReminders(Context context) {
        UserManager um = context.getSystemService(UserManager.class);
        if (um == null || !um.isUserUnlocked()) return;

        ensureReminderChannel(context);

        NotificationStorage storage = new NotificationStorage(context);
        List<String> ids = storage.getSavedNotificationIds();
        if (ids == null || ids.isEmpty()) return;

        Date now = new Date();
        Calendar nowCal = Calendar.getInstance();
        nowCal.setTime(now);

        List<LocalNotification> toSchedule = new ArrayList<>();
        List<String> catchUpIds = new ArrayList<>();

        for (String id : ids) {
            LocalNotification notification = storage.getSavedNotification(id);
            if (notification == null) continue;

            LocalNotificationSchedule schedule = notification.getSchedule();
            if (schedule == null) continue;

            if (notification.getCancelled()) {
                storage.deleteNotification(id);
                continue;
            }

            Date at = schedule.getAt();
            if (at != null) {
                if (at.after(now)) {
                    toSchedule.add(notification);
                } else {
                    Calendar atCal = Calendar.getInstance();
                    atCal.setTime(at);
                    boolean sameDay = nowCal.get(Calendar.YEAR) == atCal.get(Calendar.YEAR)
                        && nowCal.get(Calendar.DAY_OF_YEAR) == atCal.get(Calendar.DAY_OF_YEAR);
                    long elapsedMs = now.getTime() - at.getTime();
                    if (sameDay && elapsedMs >= 0 && elapsedMs <= SAME_DAY_CATCH_UP_WINDOW_MS) {
                        toSchedule.add(notification);
                        catchUpIds.add(id);
                    } else if (!sameDay) {
                        storage.deleteNotification(id);
                    }
                }
            } else if (schedule.isPerpetual()) {
                toSchedule.add(notification);
            }
        }

        if (!toSchedule.isEmpty()) {
            CapConfig config = CapConfig.loadDefault(context);
            LocalNotificationManager localNotificationManager = new LocalNotificationManager(storage, null, context, config);
            localNotificationManager.schedule(null, toSchedule);
        }

        for (String id : catchUpIds) {
            storage.setCancelled(id, true);
        }
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (context == null || intent == null || intent.getAction() == null) return;
        restoreScheduledReminders(context);
    }
}
