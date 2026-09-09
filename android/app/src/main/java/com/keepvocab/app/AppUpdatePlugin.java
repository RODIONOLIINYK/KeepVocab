package com.keepvocab.app;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.atomic.AtomicBoolean;

@CapacitorPlugin(name = "AppUpdate")
public class AppUpdatePlugin extends Plugin {
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean downloading = new AtomicBoolean(false);

    @PluginMethod
    public void getVersion(PluginCall call) {
        try {
            PackageInfo info = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            JSObject result = new JSObject();
            result.put("version", info.versionName);
            call.resolve(result);
        } catch (Exception error) { call.reject("Cannot read the installed version.", error); }
    }

    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        String source = call.getString("url", "");
        String digest = call.getString("sha256", "");
        final long size;
        Object rawSize = call.getData().opt("size");
        if (rawSize instanceof Number) {
            size = ((Number) rawSize).longValue();
        } else if (rawSize instanceof String) {
            long parsed = 0L;
            try { parsed = Long.parseLong((String) rawSize); } catch (Exception ignored) {}
            size = parsed;
        } else {
            size = 0L;
        }
        // Only this repository's APKs can enter the installer. Android also
        // verifies the package name, version and signing certificate below.
        if (!source.matches("https://github\\.com/RODIONOLIINYK/KeepVocab/releases/download/v[0-9]+\\.[0-9]+\\.[0-9]+/KeepVocab-[0-9]+\\.[0-9]+\\.[0-9]+-Android-(debug|release)\\.apk")
                || (digest == null || !digest.matches("[a-fA-F0-9]{64}"))
                || size <= 0 || size > 150000000) {
            call.reject("Invalid update package."); return;
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
            getActivity().startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName())));
            JSObject result = new JSObject();
            result.put("status", "permission-required");
            result.put("message", "Allow updates from KeepVocab, then return and tap Update again.");
            call.resolve(result); return;
        }
        if (!downloading.compareAndSet(false, true)) { call.reject("An update is already downloading."); return; }
        executor.execute(() -> {
            File file = new File(getContext().getCacheDir(), "keepvocab-update.apk");
            try {
                URL url = new URL(source);
                HttpURLConnection connection = null;
                for (int redirect = 0; redirect < 5; redirect++) {
                    if (!"https".equals(url.getProtocol()) || !("github.com".equals(url.getHost()) || "release-assets.githubusercontent.com".equals(url.getHost()) || "objects.githubusercontent.com".equals(url.getHost()))) throw new Exception("Untrusted download host.");
                    connection = (HttpURLConnection) url.openConnection();
                    connection.setConnectTimeout(15000); connection.setReadTimeout(60000); connection.setInstanceFollowRedirects(false);
                    int status = connection.getResponseCode();
                    if (status == 200) break;
                    if (status < 300 || status >= 400) throw new Exception("Download unavailable. Try again later.");
                    String location = connection.getHeaderField("Location"); connection.disconnect();
                    url = new URL(url, location);
                }
                if (connection == null || connection.getResponseCode() != 200) throw new Exception("Too many download redirects.");
                MessageDigest hash = MessageDigest.getInstance("SHA-256"); long bytes = 0;
                try (InputStream input = connection.getInputStream(); FileOutputStream output = new FileOutputStream(file)) {
                    byte[] buffer = new byte[16384]; int read;
                    while ((read = input.read(buffer)) != -1) {
                        bytes += read; if (bytes > size) throw new Exception("Unexpected update size.");
                        hash.update(buffer, 0, read); output.write(buffer, 0, read);
                    }
                } finally { connection.disconnect(); }
                StringBuilder actual = new StringBuilder();
                for (byte value : hash.digest()) actual.append(String.format("%02x", value & 0xff));
                if (bytes != size || !actual.toString().equalsIgnoreCase(digest)) throw new Exception("Update verification failed. Try again.");
                int flags = android.content.pm.PackageManager.GET_SIGNATURES;
                PackageInfo incoming = getContext().getPackageManager().getPackageArchiveInfo(file.getAbsolutePath(), flags);
                PackageInfo installed = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), flags);
                if (incoming == null || !installed.packageName.equals(incoming.packageName) || incoming.versionCode <= installed.versionCode) throw new Exception("This package is not a newer KeepVocab update.");
                if (incoming.signatures == null || installed.signatures == null || !java.util.Arrays.equals(incoming.signatures, installed.signatures)) throw new Exception("This update uses a different signing key. Your existing app and data have been kept.");
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", file);
                Intent intent = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, "application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    try {
                        getContext().startActivity(intent);
                        JSObject result = new JSObject(); result.put("status", "installer-open"); result.put("message", "Confirm Update in the Android installer. Your learning data stays saved."); call.resolve(result);
                    } catch (Exception error) { call.reject("Could not open the installer.", error); }
                });
            } catch (Exception error) { file.delete(); call.reject(error.getMessage(), error); }
            finally { downloading.set(false); }
        });
    }
}
