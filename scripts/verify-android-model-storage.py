"""Exercise the actual Android storage plugin with JSON integers and real files.

Supply an org.json JAR and a JDK on PATH. Thin test doubles replace only the
Android/Capacitor bridge; JSONObject parsing and all plugin file IO are real.
Android lint separately checks compatibility with minSdk 24.
"""
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
jar = Path(sys.argv[1]).resolve()
sources = {
    'android/util/Base64.java': '''package android.util; public class Base64 {
public static final int DEFAULT=0,NO_WRAP=2;
public static byte[] decode(String text,int flags){return java.util.Base64.getDecoder().decode(text);}
public static String encodeToString(byte[] b,int offset,int count,int flags){return java.util.Base64.getEncoder().encodeToString(java.util.Arrays.copyOfRange(b,offset,offset+count));}}''',
    'com/getcapacitor/JSObject.java': '''package com.getcapacitor; public class JSObject extends org.json.JSONObject { public JSObject(){} public JSObject(String s){super(s);} }''',
    'com/getcapacitor/JSArray.java': '''package com.getcapacitor; public class JSArray extends org.json.JSONArray { public JSArray(){} public JSArray(String s){super(s);} }''',
    'com/getcapacitor/Plugin.java': '''package com.getcapacitor; public class Plugin {
public static class Context {public static java.io.File root; public java.io.File getNoBackupFilesDir(){return root;}}
public static class Bridge {public void execute(Runnable r){r.run();}}
public Context getContext(){return new Context();} public Bridge getBridge(){return new Bridge();}}''',
    'com/getcapacitor/PluginMethod.java': '''package com.getcapacitor; public @interface PluginMethod {}''',
    'com/getcapacitor/annotation/CapacitorPlugin.java': '''package com.getcapacitor.annotation; public @interface CapacitorPlugin {String name();}''',
    'com/getcapacitor/PluginCall.java': '''package com.getcapacitor; public class PluginCall {
private final JSObject data; public JSObject result; public String error;
public PluginCall(JSObject data){this.data=data;}
public JSObject getData(){return data;}
public String getString(String key){return data.optString(key,null);}
public String getString(String key,String fallback){return data.optString(key,fallback);}
public Long getLong(String key,Long fallback){Object v=data.opt(key); return v instanceof Long?(Long)v:fallback;}
public JSArray getArray(String key){org.json.JSONArray a=data.optJSONArray(key);return a==null?null:new JSArray(a.toString());}
public void resolve(JSObject value){result=value;}
public void reject(String message,Exception exception){error=message;}}''',
    'Harness.java': '''import com.getcapacitor.*; import com.keepvocab.app.ModelStoragePlugin;
import java.io.*; import java.util.*;
public class Harness {
static ModelStoragePlugin plugin=new ModelStoragePlugin();
static JSObject run(String action,Object... fields) throws Exception {
 JSObject data=new JSObject(); data.put("action",action); data.put("cache","keepvocab-meaning-model-v1");
 data.put("key",String.join("",Collections.nCopies(64,"a")));data.put("token",String.join("",Collections.nCopies(24,"b")));
 for(int i=0;i<fields.length;i+=2)data.put((String)fields[i],fields[i+1]);
 PluginCall call=new PluginCall(new JSObject(data.toString()));plugin.operate(call);
 if(call.error!=null)throw new Exception(call.error);if(call.result==null)throw new Exception("No result");return call.result;
}
static void check(boolean condition,String message){if(!condition)throw new AssertionError(message);}
public static void main(String[] args)throws Exception{
 Plugin.Context.root=new File(args[0]);
 check(new JSObject("{\\"offset\\":0}").opt("offset") instanceof Integer,"fixture must use real JSON integers");
 byte[] expected=new byte[2*1024*1024+33];for(int i=0;i<expected.length;i++)expected[i]=(byte)(i*37);
 for(int offset=0;offset<expected.length;offset+=1024*1024){byte[] part=Arrays.copyOfRange(expected,offset,Math.min(expected.length,offset+1024*1024));run("write","offset",offset,"data",Base64.getEncoder().encodeToString(part));}
 check(run("stat").length()==0,"uncommitted model must stay invisible");
 boolean rejected=false;try{run("commit","size",expected.length+1);}catch(Exception e){rejected=true;}check(rejected,"incomplete commit must fail");
 run("commit","size",expected.length,"url","https://models.test/reference","headers",new JSArray("[[\\"content-length\\",\\"2097185\\"]]"));
 check(run("stat").getLong("size")==expected.length,"committed size mismatch");
 ByteArrayOutputStream actual=new ByteArrayOutputStream();for(int offset=0;offset<expected.length;){byte[] part=Base64.getDecoder().decode(run("read","offset",offset).getString("data"));check(part.length>0,"empty chunk");actual.write(part);offset+=part.length;}
 check(Arrays.equals(expected,actual.toByteArray()),"chunked round trip mismatch");
 check(run("keys").getJSONArray("urls").length()==1,"cache key missing");
 rejected=false;try{run("stat","cache","../outside");}catch(Exception e){rejected=true;}check(rejected,"traversal must fail");
 run("delete");check(run("stat").length()==0,"delete left model data");
 run("write","offset",0,"data",Base64.getEncoder().encodeToString(new byte[]{1}));run("abort");
 run("drop");check(new File(Plugin.Context.root,"models").list().length==0,"drop left model directory");
 System.out.println("Android plugin storage verified: JSON Integer bridge, atomic commit, 3-chunk round trip, incomplete rejection, traversal rejection, removal and abort.");
}}
'''
}
with tempfile.TemporaryDirectory(prefix='keepvocab-android-storage-') as temp:
    directory = Path(temp)
    for name, source in sources.items():
        target = directory / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(source)
    plugin = ROOT / 'android/app/src/main/java/com/keepvocab/app/ModelStoragePlugin.java'
    subprocess.run(['javac', '--release', '8', '-cp', str(jar), '-d', str(directory / 'classes'),
                    *map(str, directory.rglob('*.java')), str(plugin)], check=True)
    subprocess.run(['java', '-cp', str(directory / 'classes') + ':' + str(jar), 'Harness', str(directory / 'private-no-backup')], check=True)
