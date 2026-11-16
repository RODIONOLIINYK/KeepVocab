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
import java.io.RandomAccessFile;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
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
                JSONObject metadata = new JSONObject(new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8));
                urls.put(metadata.getString("url"));
            }
            result.put("urls", urls); return result;
        }
        String key = call.getString("key", "");
        if (!key.matches("[a-f0-9]{64}")) throw new Exception("Invalid model key");
        File file = new File(directory, key), metadata = new File(directory, key + ".json");
        if (action.equals("stat")) {
            if (!file.isFile() || !metadata.isFile()) return result;
            JSObject info = new JSObject(new String(Files.readAllBytes(metadata.toPath()), StandardCharsets.UTF_8));
            return file.length() == info.getLong("size") ? info : result;
        }
        if (action.equals("read")) {
            long offset = call.getLong("offset", -1L);
            if (offset < 0) throw new Exception("Invalid model offset");
            try (RandomAccessFile input = new RandomAccessFile(file, "r")) {
                input.seek(offset);
                byte[] bytes = new byte[CHUNK]; int count = input.read(bytes);
                result.put("data", count < 0 ? "" : Base64.encodeToString(bytes, 0, count, Base64.NO_WRAP));
            }
            return result;
        }
        if (action.equals("delete")) {
            Files.deleteIfExists(metadata.toPath()); Files.deleteIfExists(file.toPath()); return result;
        }
        String token = call.getString("token", "");
        if (!token.matches("[a-f0-9]{16,64}")) throw new Exception("Invalid download token");
        File temporary = new File(directory, key + "." + token + ".part");
        if (action.equals("abort")) { Files.deleteIfExists(temporary.toPath()); return result; }
        if (!directory.isDirectory() && !directory.mkdirs()) throw new Exception("Cannot create model folder");
        if (action.equals("write")) {
            byte[] bytes = Base64.decode(call.getString("data", ""), Base64.DEFAULT);
            long offset = call.getLong("offset", -1L);
            if (offset < 0 || bytes.length > CHUNK || (offset > 0 && temporary.length() != offset)) throw new Exception("Invalid model chunk");
            try (FileOutputStream output = new FileOutputStream(temporary, offset != 0)) { output.write(bytes); }
            return result;
        }
        if (action.equals("commit")) {
            long size = call.getLong("size", -1L);
            if (!temporary.isFile() || temporary.length() != size) throw new Exception("Incomplete model download");
            JSObject info = new JSObject(); info.put("size", size); info.put("headers", call.getArray("headers")); info.put("url", call.getString("url"));
            File infoTemporary = new File(directory, key + "." + token + ".json.part");
            Files.write(infoTemporary.toPath(), info.toString().getBytes(StandardCharsets.UTF_8));
            Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING);
            Files.move(infoTemporary.toPath(), metadata.toPath(), StandardCopyOption.REPLACE_EXISTING);
            return result;
        }
        throw new Exception("Unknown model operation");
    }

    private void removeTree(File file) throws Exception {
        File[] children = file.listFiles();
        if (children != null) for (File child : children) removeTree(child);
        Files.deleteIfExists(file.toPath());
    }
}
