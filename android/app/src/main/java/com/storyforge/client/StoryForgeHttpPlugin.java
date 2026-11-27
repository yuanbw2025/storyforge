package com.storyforge.client;

import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;
import java.util.Collections;
import java.util.HashMap;
import java.util.Set;
import java.util.Map;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "StoryForgeHttp")
public class StoryForgeHttpPlugin extends Plugin {
    private static class Transfer {
        volatile HttpURLConnection connection;
        volatile InputStream input;
        volatile boolean cancelled;
        void close() {
            cancelled = true;
            if (connection != null) connection.disconnect();
            try { if (input != null) input.close(); } catch (Exception ignored) { }
        }
    }
    private static class Pending {
        Map<Integer, byte[]> chunks;
        int received;
        int total;
        String hash;
        String url;
        String method;
        JSObject headers;
        Pending(int total, String hash, String url, String method, JSObject headers) {
            this.chunks = new HashMap<>(); this.total = total; this.hash = hash;
            this.url = url; this.method = method; this.headers = headers;
        }
    }
    private final Map<String, Transfer> active = new ConcurrentHashMap<>();
    private final Map<String, Pending> pending = new ConcurrentHashMap<>();
    private final Set<String> cancelled = Collections.newSetFromMap(new ConcurrentHashMap<String, Boolean>());
    private final ExecutorService workers = Executors.newFixedThreadPool(8);

    @PluginMethod public void getCapabilities(PluginCall call) {
        JSObject result = new JSObject();
        result.put("chunkedBodyVersion", 1);
        call.resolve(result);
    }
    @PluginMethod public void openChunked(PluginCall call) {
        String id = call.getString("id", "");
        Integer chunkIndex = parseInt(call, "chunkIndex");
        Integer total = parseInt(call, "totalChunks");
        String hash = call.getString("bodySha256", "");
        String body = call.getString("body");
        if (!id.matches("[a-f0-9-]{36}") || cancelled.contains(id) || active.containsKey(id)
            || chunkIndex == null || total == null || total < 1
            || chunkIndex < 0 || chunkIndex >= total
            || !hash.matches("[a-f0-9]{64}") || body == null || body.isEmpty()
            || active.containsKey(id)) { call.reject("Invalid chunked transfer"); return; }
        final byte[] chunk;
        try { chunk = Base64.decode(body, Base64.DEFAULT); } catch (Exception ignored) { call.reject("Invalid chunk data"); return; }
        if (chunk.length == 0 || chunk.length > 4 * 1024 * 1024) { call.reject("Invalid chunk size"); return; }
        Pending state = pending.get(id);
        if (state == null) {
            String urlValue = call.getString("url", "");
            String method = call.getString("method", "GET");
            JSObject headers = call.getObject("headers", new JSObject());
            if (!method.equals("POST") || pending.size() >= 16 || active.size() >= 16) { call.reject("Invalid chunked transfer"); return; }
            try {
                URL url = new URL(urlValue);
                if (!url.getProtocol().equals("https") || url.getUserInfo() != null) throw new Exception();
            } catch (Exception ignored) { call.reject("Invalid chunked transfer"); return; }
            state = new Pending(total, hash, urlValue, method, headers);
            pending.put(id, state);
        } else if (!state.hash.equals(hash) || !state.url.equals(call.getString("url", ""))
            || !state.method.equals(call.getString("method", "GET")) || !state.headers.toString().equals(call.getObject("headers", new JSObject()).toString())
            || state.chunks.containsKey(chunkIndex)
            || state.total != total) { call.reject("Inconsistent chunked transfer"); return; }
        state.chunks.put(chunkIndex, chunk); state.received++;
        if (state.received != state.total) {
            JSObject pendingResult = new JSObject();
            pendingResult.put("status", 0); pendingResult.put("headers", new JSObject());
            call.resolve(pendingResult); return;
        }
        pending.remove(id);
        final Pending ready = state;
        dispatchChunked(id, ready, call);
    }
    private void dispatchChunked(String id, Pending ready, PluginCall call) {
        Transfer transfer = new Transfer();
        active.put(id, transfer);
        workers.execute(() -> {
            try {
                ByteArrayOutputStream combined = new ByteArrayOutputStream();
                for (int index = 0; index < ready.total; index++) {
                    byte[] part = ready.chunks.get(index);
                    if (part == null) throw new Exception();
                    combined.write(part);
                }
                byte[] bytes = combined.toByteArray();
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                String actual = bytesToHex(digest.digest(bytes));
                if (!actual.equals(ready.hash)) throw new Exception();
                URL url = new URL(ready.url);
                if (!url.getProtocol().equals("https") || url.getUserInfo() != null) throw new Exception();
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                transfer.connection = connection;
                if (transfer.cancelled) throw new Exception();
                connection.setConnectTimeout(30000); connection.setReadTimeout(600000);
                connection.setInstanceFollowRedirects(false); connection.setRequestMethod(ready.method);
                for (java.util.Iterator<String> keys = ready.headers.keys(); keys.hasNext();) {
                    String key = keys.next();
                    if (!key.equalsIgnoreCase("host") && !key.equalsIgnoreCase("cookie") && !key.equalsIgnoreCase("content-length"))
                        connection.setRequestProperty(key, ready.headers.getString(key));
                }
                connection.setDoOutput(true); connection.setFixedLengthStreamingMode(bytes.length);
                try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                int status = connection.getResponseCode();
                transfer.input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (transfer.cancelled) throw new Exception();
                JSObject resultHeaders = new JSObject();
                for (Map.Entry<String, java.util.List<String>> header : connection.getHeaderFields().entrySet())
                    if (header.getKey() != null && !header.getKey().equalsIgnoreCase("set-cookie"))
                        resultHeaders.put(header.getKey(), String.join(", ", header.getValue()));
                JSObject result = new JSObject();
                result.put("status", status); result.put("headers", resultHeaders);
                call.resolve(result);
            } catch (Exception ignored) {
                active.remove(id); transfer.close();
                call.reject("Native request failed or cancelled; delivery may be unknown. No automatic retry.");
            }
        });
    }
    private static Integer parseInt(PluginCall call, String key) {
        try { return Integer.valueOf(call.getString(key, "")); }
        catch (Exception ignored) { return null; }
    }
    private static String bytesToHex(byte[] bytes) {
        StringBuilder value = new StringBuilder();
        for (byte item : bytes) value.append(String.format("%02x", item & 0xff));
        return value.toString();
    }
    @PluginMethod public void open(PluginCall call) {
        String id = call.getString("id", "");
        cancelled.remove(id);
        if (!id.matches("[a-f0-9-]{36}") || active.size() >= 16 || active.containsKey(id)) { call.reject("Invalid or busy transfer"); return; }
        Transfer transfer = new Transfer();
        active.put(id, transfer);
        workers.execute(() -> {
            try {
                URL url = new URL(call.getString("url", ""));
                if (!url.getProtocol().equals("https") || url.getUserInfo() != null) throw new Exception();
                HttpURLConnection connection = (HttpURLConnection) url.openConnection();
                transfer.connection = connection;
                if (transfer.cancelled) throw new Exception();
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(600000);
                // Never follow redirects carrying a user's provider credentials.
                connection.setInstanceFollowRedirects(false);
                connection.setRequestMethod(call.getString("method", "GET"));
                JSObject headers = call.getObject("headers", new JSObject());
                for (java.util.Iterator<String> keys = headers.keys(); keys.hasNext();) {
                    String key = keys.next();
                    if (!key.equalsIgnoreCase("host") && !key.equalsIgnoreCase("cookie") && !key.equalsIgnoreCase("content-length"))
                        connection.setRequestProperty(key, headers.getString(key));
                }
                String body = call.getString("body");
                if (body != null) {
                    // B20d: no application 32 MiB ceiling; one logical POST
                    // may carry the complete body. Segmenting is bridge-internal
                    // via openChunked, never a content quota.
                    byte[] bytes = Base64.decode(body, Base64.DEFAULT);
                    connection.setDoOutput(true);
                    connection.setFixedLengthStreamingMode(bytes.length);
                    try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
                }
                int status = connection.getResponseCode();
                transfer.input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                if (transfer.cancelled) throw new Exception();
                JSObject resultHeaders = new JSObject();
                for (Map.Entry<String, List<String>> header : connection.getHeaderFields().entrySet())
                    if (header.getKey() != null && !header.getKey().equalsIgnoreCase("set-cookie"))
                        resultHeaders.put(header.getKey(), String.join(", ", header.getValue()));
                JSObject result = new JSObject();
                result.put("status", status); result.put("headers", resultHeaders);
                call.resolve(result);
            } catch (Exception ignored) {
                active.remove(id); transfer.close();
                call.reject("Native request failed or cancelled; delivery may be unknown. No automatic retry.");
            }
        });
    }
    @PluginMethod public void read(PluginCall call) {
        String id = call.getString("id", "");
        Transfer transfer = active.get(id);
        if (transfer == null) { call.reject("Transfer closed"); return; }
        workers.execute(() -> {
            try {
                byte[] buffer = new byte[32768];
                int count = transfer.input == null ? -1 : transfer.input.read(buffer);
                if (transfer.cancelled) throw new Exception();
                JSObject result = new JSObject();
                result.put("done", count < 0);
                if (count >= 0) result.put("data", Base64.encodeToString(buffer, 0, count, Base64.NO_WRAP));
                else { active.remove(id); transfer.close(); }
                call.resolve(result);
            } catch (Exception ignored) { active.remove(id); transfer.close(); call.reject("Native stream interrupted"); }
        });
    }
    @PluginMethod public void cancel(PluginCall call) {
        String id = call.getString("id", "");
        if (pending.remove(id) != null) cancelled.add(id);
        Transfer transfer = active.remove(id);
        if (transfer != null) transfer.close();
        call.resolve();
    }
    @Override protected void handleOnDestroy() {
        for (Transfer transfer : active.values()) transfer.close();
        active.clear(); pending.clear(); cancelled.clear(); workers.shutdownNow();
    }
}
