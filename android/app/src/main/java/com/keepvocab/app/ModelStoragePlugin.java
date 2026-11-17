package com.keepvocab.app;

import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import android.net.Uri;
import com.getcapacitor.FileUtils;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

@CapacitorPlugin(name = "ModelStorage")
public class ModelStoragePlugin extends Plugin {
    private static final int CHUNK = 1024 * 1024;

    @PluginMethod
    public void operate(PluginCall call) {
        // noBackupFilesDir is private app storage: uninstall clears it, cloud
        // backup never copies hundreds of MB of reproducible model downloads.
        getBridge().execute(() -> {
            try { call.resolve(operation(call)); }
            catch (Exception error) { call.reject("Model storage operation failed: " + error.getMessage(), error); }
        });
    }

    private JSObject operation(PluginCall call) throws Exception {
        File root = new File(getContext().getNoBackupFilesDir(), "models");
        String action = call.getString("action", "");
        JSObject result = new JSObject();
        if (action.equals("caches")) {
            JSArray names = new JSArray();
            File[] dirs = root.listFiles();
            if (dirs != null) for (File dir : dirs) if (dir.isDirectory()) names.put(dir.getName());
            result.put("names", names); return result;
        }
        String cache = call.getString("cache", "");
        if (!cache.matches("keepvocab-[a-z0-9-]{1,70}")) throw new Exception("Invalid model cache");
        File directory = new File(root, cache);
        if (action.equals("drop")) { removeTree(directory); return result; }
        if (action.equals("keys")) {
            JSArray urls = new JSArray();
            File[] files = directory.listFiles();
            if (files != null) for (File file : files) if (file.getName().matches("[a-f0-9]{64}\\.json")) {
                JSONObject metadata = new JSONObject(readMetadata(file));
                urls.put(metadata.getString("url"));
            }
            result.put("urls", urls); return result;
        }
        String key = call.getString("key", "");
        if (!key.matches("[a-f0-9]{64}")) throw new Exception("Invalid model key");
        File file = new File(directory, key), metadata = new File(directory, key + ".json");
        if (action.equals("stat")) {
            if (!file.isFile() || !metadata.isFile()) return result;
            JSObject info = new JSObject(readMetadata(metadata));
            if (file.length() != info.getLong("size")) return result;
            // Capacitor streams the private file through its existing WebView
            // server. Only validated, committed cache files get a portable URL.
            info.put("readUrl", FileUtils.getPortablePath(getContext(), getBridge().getLocalUrl(), Uri.fromFile(file)));
            return info;
        }
        if (action.equals("delete")) {
            deleteIfExists(metadata); deleteIfExists(file); return result;
        }
        String token = call.getString("token", "");
        if (!token.matches("[a-f0-9]{16,64}")) throw new Exception("Invalid download token");
        File temporary = new File(directory, key + "." + token + ".part");
        if (action.equals("abort")) { deleteIfExists(temporary); return result; }
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create model folder");
        if (action.equals("write")) {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            long offset = modelNumber(call, "offset");
            if (bytes.length > CHUNK || (offset > 0 && temporary.length() != offset)) throw new Exception("Invalid model chunk");
            try (FileOutputStream output = new FileOutputStream(temporary, offset != 0)) { output.write(bytes); }
            return result;
        }
        if (action.equals("commit")) {
            long size = modelNumber(call, "size");
            if (!temporary.isFile() || temporary.length() != size) throw new Exception("Incomplete model download");
            JSObject info = new JSObject(); info.put("size", size); info.put("headers", call.getArray("headers")); info.put("url", call.getString("url"));
            File infoTemporary = new File(directory, key + "." + token + ".json.part");
            try (FileOutputStream output = new FileOutputStream(infoTemporary)) { output.write(info.toString().getBytes(StandardCharsets.UTF_8)); }
            if (!temporary.renameTo(file) || !infoTemporary.renameTo(metadata)) throw new Exception("Cannot commit model file");
            return result;
        }
        throw new Exception("Unknown model operation");
    }

    private void removeTree(File file) throws Exception {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) removeTree(child);
        deleteIfExists(file);
    }

    // java.nio.file requires API 26; the app supports API 24 and 25 too.
    private String readMetadata(File file) throws Exception {
        try (FileInputStream input = new FileInputStream(file); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }

    private void deleteIfExists(File file) throws Exception {
        if (file.exists() && !file.delete()) throw new Exception("Cannot remove model file");
    }

    private long modelNumber(PluginCall call, String name) throws Exception {
        // JSON uses Integer for these small values. Capacitor getLong accepts
        // only Long and would silently return its fallback for normal chunks.
        Object raw = call.getData().opt(name);
        if (!(raw instanceof Number)) throw new Exception("Invalid model " + name);
        double value = ((Number) raw).doubleValue();
        if (Double.isNaN(value) || value < 0 || value > 350_000_000 || value != Math.floor(value)) throw new Exception("Invalid model " + name);
        return (long) value;
    }
}
