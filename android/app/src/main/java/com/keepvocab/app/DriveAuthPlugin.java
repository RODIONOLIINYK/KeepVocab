package com.keepvocab.app;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.auth.api.identity.RevokeAccessRequest;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import java.util.Arrays;
import java.util.List;

@CapacitorPlugin(name = "DriveAuth", requestCodes = { DriveAuthPlugin.REQUEST_AUTHORIZE })
public class DriveAuthPlugin extends Plugin {

    static final int REQUEST_AUTHORIZE = 7301;
    private static final String DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";
    private static final String USERINFO_EMAIL_SCOPE = "https://www.googleapis.com/auth/userinfo.email";
    private static final int DEFAULT_TOKEN_LIFETIME_SECONDS = 3600;
    private static final List<Scope> REQUESTED_SCOPES = Arrays.asList(
        new Scope(DRIVE_FILE_SCOPE),
        new Scope(USERINFO_EMAIL_SCOPE)
    );

    private AuthorizationClient client() {
        return Identity.getAuthorizationClient(getActivity());
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        AuthorizationRequest request = AuthorizationRequest.builder().setRequestedScopes(REQUESTED_SCOPES).build();

        client()
            .authorize(request)
            .addOnSuccessListener(result -> {
                if (!result.hasResolution()) {
                    resolveAuthorization(call, result);
                    return;
                }
                if (!interactive) {
                    call.reject("Google Drive needs you to reconnect once in the Android app.", "RECONNECT_REQUIRED");
                    return;
                }
                try {
                    saveCall(call);
                    getActivity().startIntentSenderForResult(
                        result.getPendingIntent().getIntentSender(),
                        REQUEST_AUTHORIZE,
                        null,
                        0,
                        0,
                        0
                    );
                } catch (IntentSender.SendIntentException error) {
                    call.reject("Google authorization could not be opened.", "AUTH_UI_FAILED", error);
                }
            })
            .addOnFailureListener(error -> rejectAuthorization(call, error));
    }

    @PluginMethod
    public void revoke(PluginCall call) {
        RevokeAccessRequest request = RevokeAccessRequest.builder().setScopes(REQUESTED_SCOPES).build();
        client()
            .revokeAccess(request)
            .addOnSuccessListener(unused -> call.resolve())
            .addOnFailureListener(error -> rejectAuthorization(call, error));
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode != REQUEST_AUTHORIZE) return;
        PluginCall call = getSavedCall();
        if (call == null) return;

        if (resultCode != Activity.RESULT_OK || data == null) {
            call.reject("Google authorization was cancelled.", "AUTH_CANCELLED");
            freeSavedCall();
            return;
        }

        try {
            AuthorizationResult result = client().getAuthorizationResultFromIntent(data);
            resolveAuthorization(call, result);
        } catch (ApiException error) {
            rejectAuthorization(call, error);
        } finally {
            freeSavedCall();
        }
    }

    private void resolveAuthorization(PluginCall call, AuthorizationResult result) {
        String accessToken = result.getAccessToken();
        if (accessToken == null || accessToken.isBlank()) {
            call.reject("Google did not return a Drive access token.", "TOKEN_MISSING");
            return;
        }
        if (!result.getGrantedScopes().contains(DRIVE_FILE_SCOPE)) {
            call.reject("Google Drive access was not granted.", "SCOPE_MISSING");
            return;
        }

        JSObject response = new JSObject();
        response.put("accessToken", accessToken);
        response.put("expiresIn", DEFAULT_TOKEN_LIFETIME_SECONDS);
        call.resolve(response);
    }

    private void rejectAuthorization(PluginCall call, Exception error) {
        int statusCode = error instanceof ApiException ? ((ApiException) error).getStatusCode() : -1;
        String message = statusCode == 10
            ? "Android Google Drive authorization is not configured. Add an Android OAuth client for com.keepvocab.app and this APK's SHA-1 certificate."
            : "Google Drive authorization failed. Check Google Play services and try again.";
        call.reject(message, statusCode < 0 ? "AUTH_FAILED" : "GOOGLE_AUTH_" + statusCode, error);
    }
}
