#!/bin/bash

# Sets the RESEND_API_KEY Edge Function secret in Supabase, so the
# send-otp-email function can deliver patient portal email.
#
# The key is never stored in this file and never printed. Supply it either:
#   - in the RESEND_API_KEY environment variable, or
#   - at the prompt this script shows (what you type is hidden).
#
# The key reaches the Supabase CLI through a temporary file that only you can
# read and that is deleted on exit, so it does not appear in the process list.
#
# Set SUPABASE_PROJECT_REF to target another project.

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-dlogqxzejroeyivfmgcv}"

echo "=========================================="
echo "  Resend API Key Setup for mBHR"
echo "=========================================="
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found!"
    echo ""
    echo "Please install it first:"
    echo "  https://supabase.com/docs/guides/cli"
    echo ""
    echo "Or set the secret manually via dashboard:"
    echo "  https://supabase.com/dashboard/project/${PROJECT_REF}/settings/edge-functions"
    echo ""
    exit 1
fi

echo "✅ Supabase CLI found"
echo ""

# Check if logged in
if ! supabase projects list &> /dev/null; then
    echo "❌ Not logged in to Supabase CLI"
    echo ""
    echo "Please login first:"
    echo "  supabase login"
    echo ""
    exit 1
fi

echo "✅ Logged in to Supabase"
echo ""

# Read the key from the environment, or ask for it without echoing it.
RESEND_API_KEY="${RESEND_API_KEY:-}"
if [ -z "$RESEND_API_KEY" ]; then
    if [ ! -t 0 ]; then
        echo "❌ RESEND_API_KEY is not set and there is no terminal to ask for it."
        echo "   Set RESEND_API_KEY in the environment and run this again."
        exit 1
    fi
    read -rs -p "Paste the Resend API key (input hidden): " RESEND_API_KEY
    echo ""
fi

if [ -z "$RESEND_API_KEY" ]; then
    echo "❌ No key entered. Nothing was changed."
    exit 1
fi

case "$RESEND_API_KEY" in
    re_*) ;;
    *)
        echo "❌ That does not look like a Resend API key (they start with re_)."
        echo "   Nothing was changed."
        exit 1
        ;;
esac

SECRETS_FILE="$(mktemp)"
trap 'rm -f "$SECRETS_FILE"' EXIT
chmod 600 "$SECRETS_FILE"
printf 'RESEND_API_KEY=%s\n' "$RESEND_API_KEY" > "$SECRETS_FILE"
unset RESEND_API_KEY

# Set the secret
echo "Setting RESEND_API_KEY secret..."
echo ""

if supabase secrets set --env-file "$SECRETS_FILE" --project-ref "$PROJECT_REF"; then
    echo ""
    echo "✅ Success! Secret has been set."
    echo ""
    echo "⏱️  Wait 30-60 seconds for edge functions to reload..."
    echo ""
    echo "📧 Test email delivery:"
    echo "  1. Sign in online as an administrator"
    echo "  2. Go to: /admin/email-diagnostics"
    echo "  3. Send a test email"
    echo "  4. Check your inbox (and spam folder)"
    echo ""
    echo "🎉 Demo mode will automatically turn off once the secret is active!"
    echo ""
else
    echo ""
    echo "❌ Failed to set secret"
    echo ""
    echo "Try setting it manually via dashboard:"
    echo "  https://supabase.com/dashboard/project/${PROJECT_REF}/settings/edge-functions"
    echo ""
    echo "Secret details:"
    echo "  Name:  RESEND_API_KEY"
    echo "  Value: the key you entered (not shown here)"
    echo ""
    exit 1
fi
