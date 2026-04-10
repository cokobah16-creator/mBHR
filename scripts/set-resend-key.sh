#!/bin/bash

# Script to set Resend API Key in Supabase Edge Functions
# Run this script to configure email delivery for the patient portal

set -e

RESEND_API_KEY="re_YFFHp3sb_M2aWRcQfak5dsr9MsvU1UPJu"

echo "=========================================="
echo "  Resend API Key Setup for mBHR"
echo "=========================================="
echo ""

# Check if supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    echo "❌ Supabase CLI not found!"
    echo ""
    echo "Please install it first:"
    echo "  npm install -g supabase"
    echo ""
    echo "Or set the secret manually via dashboard:"
    echo "  https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/edge-functions"
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

# Set the secret
echo "Setting RESEND_API_KEY secret..."
echo ""

if supabase secrets set RESEND_API_KEY="$RESEND_API_KEY" --project-ref dlogqxzejroeyivfmgcv; then
    echo ""
    echo "✅ Success! Secret has been set."
    echo ""
    echo "⏱️  Wait 30-60 seconds for edge functions to reload..."
    echo ""
    echo "📧 Test email delivery:"
    echo "  1. Go to: /admin/email-diagnostics"
    echo "  2. Send a test email"
    echo "  3. Check your inbox (and spam folder)"
    echo ""
    echo "🎉 Demo mode will automatically turn off once the secret is active!"
    echo ""
else
    echo ""
    echo "❌ Failed to set secret"
    echo ""
    echo "Try setting it manually via dashboard:"
    echo "  https://supabase.com/dashboard/project/dlogqxzejroeyivfmgcv/settings/edge-functions"
    echo ""
    echo "Secret details:"
    echo "  Name:  RESEND_API_KEY"
    echo "  Value: $RESEND_API_KEY"
    echo ""
    exit 1
fi
