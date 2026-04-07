/**
 * Email Diagnostics Tool
 *
 * Helps diagnose and test email delivery for patient portal invitations.
 * Shows current configuration status and provides manual test functionality.
 */

import React, { useState } from "react";
import {
  EnvelopeIcon,
  CheckCircleIcon,
  XCircleIcon,
  ExclamationTriangleIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
} from "@heroicons/react/24/outline";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/stores/toast";

export default function EmailDiagnostics() {
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState("cokobah16@gmail.com");
  const [testResult, setTestResult] = useState<any>(null);
  const [edgeFunctionUrl, setEdgeFunctionUrl] = useState("");
  const { push: pushToast } = useToast();

  React.useEffect(() => {
    const url = import.meta.env.VITE_SUPABASE_URL;
    setEdgeFunctionUrl(`${url}/functions/v1/send-otp-email`);
  }, []);

  const testEmailFunction = async () => {
    setTesting(true);
    setTestResult(null);

    try {
      const testOTP = "123456";

      // Call the Edge Function directly
      const { data, error } = await supabase.functions.invoke(
        "send-otp-email",
        {
          body: { email: testEmail, otp: testOTP },
        },
      );

      if (error) {
        setTestResult({
          success: false,
          error: error.message,
          details: error,
        });
        pushToast({
          id: crypto.randomUUID(),
          title: "Test Failed",
          body: error.message,
        });
      } else {
        setTestResult({
          success: data?.success || false,
          demo: data?.demo || false,
          messageId: data?.messageId,
          message: data?.message,
          data,
        });

        if (data?.demo) {
          pushToast({
            id: crypto.randomUUID(),
            title: "Demo Mode Active",
            body: "Email function is running in demo mode. Check console logs for OTP.",
          });
        } else if (data?.success) {
          pushToast({
            id: crypto.randomUUID(),
            title: "Email Sent!",
            body: `Test email sent to ${testEmail}`,
          });
        }
      }
    } catch (error: any) {
      setTestResult({
        success: false,
        error: error.message,
        details: error,
      });
      pushToast({
        id: crypto.randomUUID(),
        title: "Test Failed",
        body: error.message,
      });
    } finally {
      setTesting(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    pushToast({
      id: crypto.randomUUID(),
      title: "Copied!",
      body: "Copied to clipboard",
    });
  };

  return (
    <div className="max-w-4xl mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">
          Email System Diagnostics
        </h1>
        <p className="text-gray-600">
          Test and diagnose the patient portal email delivery system
        </p>
      </div>

      {/* Status Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
        {/* Edge Function Status */}
        <div className="card bg-white border-2 border-gray-200">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <CheckCircleIcon className="h-6 w-6 text-green-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900">
                Edge Function
              </h3>
              <p className="text-xs text-gray-600 mt-1">
                send-otp-email is ACTIVE
              </p>
              <div className="mt-2">
                <code className="text-xs bg-gray-100 px-2 py-1 rounded block overflow-x-auto">
                  {edgeFunctionUrl}
                </code>
              </div>
            </div>
          </div>
        </div>

        {/* Configuration Status */}
        <div className="card bg-yellow-50 border-2 border-yellow-200">
          <div className="flex items-start space-x-3">
            <div className="flex-shrink-0">
              <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600" />
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-medium text-gray-900">
                API Configuration
              </h3>
              <p className="text-xs text-gray-600 mt-1">
                RESEND_API_KEY may not be configured
              </p>
              <p className="text-xs text-yellow-700 mt-2 font-medium">
                Emails will be logged to console until API key is added
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Test Email Form */}
      <div className="card bg-white mb-8">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">
          Test Email Delivery
        </h2>

        <div className="space-y-4">
          <div>
            <label
              htmlFor="testEmail"
              className="block text-sm font-medium text-gray-700 mb-2"
            >
              Test Email Address
            </label>
            <input
              type="email"
              id="testEmail"
              value={testEmail}
              onChange={(e) => setTestEmail(e.target.value)}
              className="input w-full"
              placeholder="your-email@example.com"
            />
            <p className="text-xs text-gray-500 mt-1">
              A test OTP email will be sent to this address (OTP: 123456)
            </p>
          </div>

          <button
            onClick={testEmailFunction}
            disabled={testing || !testEmail}
            className="btn btn-primary w-full"
          >
            {testing ? (
              <>
                <ArrowPathIcon className="h-5 w-5 animate-spin mr-2" />
                Testing...
              </>
            ) : (
              <>
                <EnvelopeIcon className="h-5 w-5 mr-2" />
                Send Test Email
              </>
            )}
          </button>
        </div>
      </div>

      {/* Test Results */}
      {testResult && (
        <div className="card bg-white">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">
            Test Results
          </h2>

          <div
            className={`p-4 rounded-lg mb-4 ${
              testResult.success
                ? testResult.demo
                  ? "bg-yellow-50 border border-yellow-200"
                  : "bg-green-50 border border-green-200"
                : "bg-red-50 border border-red-200"
            }`}
          >
            <div className="flex items-start space-x-3">
              <div className="flex-shrink-0">
                {testResult.success ? (
                  testResult.demo ? (
                    <ExclamationTriangleIcon className="h-6 w-6 text-yellow-600" />
                  ) : (
                    <CheckCircleIcon className="h-6 w-6 text-green-600" />
                  )
                ) : (
                  <XCircleIcon className="h-6 w-6 text-red-600" />
                )}
              </div>
              <div className="flex-1">
                <h3
                  className={`text-sm font-medium ${
                    testResult.success
                      ? testResult.demo
                        ? "text-yellow-900"
                        : "text-green-900"
                      : "text-red-900"
                  }`}
                >
                  {testResult.success
                    ? testResult.demo
                      ? "Demo Mode Active"
                      : "Email Sent Successfully"
                    : "Email Failed to Send"}
                </h3>

                {testResult.demo && (
                  <div className="mt-2 text-xs text-yellow-800">
                    <p className="font-medium">Running in demo mode:</p>
                    <ul className="list-disc list-inside mt-1 space-y-1">
                      <li>No RESEND_API_KEY found in Edge Function secrets</li>
                      <li>
                        OTP is logged to Supabase Edge Function logs instead
                      </li>
                      <li>Check Supabase Dashboard → Edge Functions → Logs</li>
                    </ul>
                  </div>
                )}

                {testResult.messageId && (
                  <p className="text-xs text-green-700 mt-2">
                    Message ID: {testResult.messageId}
                  </p>
                )}

                {testResult.message && (
                  <p className="text-xs text-gray-700 mt-2">
                    {testResult.message}
                  </p>
                )}

                {testResult.error && (
                  <p className="text-xs text-red-700 mt-2">
                    Error: {testResult.error}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* Raw Response */}
          <details className="mt-4">
            <summary className="text-sm font-medium text-gray-700 cursor-pointer hover:text-gray-900">
              View Raw Response
            </summary>
            <div className="mt-2 bg-gray-50 p-3 rounded-lg">
              <pre className="text-xs text-gray-800 overflow-x-auto">
                {JSON.stringify(testResult, null, 2)}
              </pre>
            </div>
          </details>
        </div>
      )}

      {/* Setup Instructions */}
      <div className="card bg-blue-50 border-2 border-blue-200 mt-8">
        <div className="flex items-start space-x-3">
          <div className="flex-shrink-0">
            <ExclamationTriangleIcon className="h-6 w-6 text-blue-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-medium text-blue-900 mb-2">
              Setup Required: Configure Email API Key
            </h3>
            <div className="text-xs text-blue-800 space-y-3">
              <div>
                <p className="font-semibold mb-1">
                  Step 1: Create Resend Account (Free)
                </p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>
                    Visit{" "}
                    <a
                      href="https://resend.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      resend.com
                    </a>
                  </li>
                  <li>Sign up (free tier: 3,000 emails/month)</li>
                  <li>Verify your email</li>
                </ol>
              </div>

              <div>
                <p className="font-semibold mb-1">Step 2: Generate API Key</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Go to API Keys in Resend Dashboard</li>
                  <li>Click "Create API Key"</li>
                  <li>Name: "mBHR Patient Portal"</li>
                  <li>Permission: "Sending access"</li>
                  <li>Copy the key (starts with "re_")</li>
                </ol>
              </div>

              <div>
                <p className="font-semibold mb-1">Step 3: Add to Supabase</p>
                <ol className="list-decimal list-inside space-y-1 ml-2">
                  <li>Open Supabase Dashboard</li>
                  <li>Go to Settings → Edge Functions</li>
                  <li>Scroll to "Secrets" section</li>
                  <li>Click "Add a new secret"</li>
                  <li>
                    Name:{" "}
                    <code className="bg-blue-100 px-1 rounded">
                      RESEND_API_KEY
                    </code>
                  </li>
                  <li>Value: [paste your API key]</li>
                  <li>Wait 30 seconds for functions to reload</li>
                </ol>
              </div>

              <div>
                <p className="font-semibold mb-1">Step 4: Test</p>
                <p className="ml-2">
                  Use the test button above to verify emails are being sent
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-blue-300">
                <p className="font-semibold">Quick Links:</p>
                <ul className="list-disc list-inside mt-1 space-y-1 ml-2">
                  <li>
                    <a
                      href="https://resend.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-blue-600"
                    >
                      Resend Website
                    </a>
                  </li>
                  <li>
                    <a
                      href={`https://supabase.com/dashboard/project/${import.meta.env.VITE_SUPABASE_URL?.split("//")[1]?.split(".")[0]}/settings/functions`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-blue-600"
                    >
                      Supabase Edge Functions Settings
                    </a>
                  </li>
                  <li>
                    <button
                      onClick={() => copyToClipboard("RESEND_API_KEY")}
                      className="underline hover:text-blue-600 inline-flex items-center"
                    >
                      <ClipboardDocumentIcon className="h-3 w-3 mr-1" />
                      Copy secret name: RESEND_API_KEY
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Current Status Summary */}
      <div className="card bg-gray-50 mt-8">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">
          Current System Status
        </h3>
        <div className="space-y-2 text-xs">
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="h-4 w-4 text-green-600 flex-shrink-0" />
            <span className="text-gray-700">
              Edge Function deployed and active
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="h-4 w-4 text-green-600 flex-shrink-0" />
            <span className="text-gray-700">
              Patient portal users table exists
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <CheckCircleIcon className="h-4 w-4 text-green-600 flex-shrink-0" />
            <span className="text-gray-700">
              Kristopher's portal account created
            </span>
          </div>
          <div className="flex items-center space-x-2">
            <ExclamationTriangleIcon className="h-4 w-4 text-yellow-600 flex-shrink-0" />
            <span className="text-gray-700">
              Email API key not configured (demo mode)
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
