#!/usr/bin/env bash
#
# Run the official HL7 FHIR Validator (Java CLI) against the fixture
# bundle in e2e/fixtures/fhir/. This is the out-of-band conformance check
# — the in-house US Core 7.0 validator (src/services/fhir/validation/core.ts)
# is the CI-mandatory gate; this script catches anything the in-house
# validator misses (e.g. value-set bindings, slicing constraints).
#
# Usage:
#   scripts/fhir-validate.sh                  validates e2e/fixtures/fhir/golden-bundle.json
#   scripts/fhir-validate.sh path/to/x.json   validates an arbitrary FHIR JSON file
#
# Requires:
#   - Java 17+
#   - Network access on first run (downloads the validator JAR + US Core IG)
#
# CI use: not part of the every-PR pipeline (Java boot is slow). Wire this
# into a nightly workflow or run before TEFCA partner onboarding.

set -euo pipefail

VALIDATOR_VERSION="${VALIDATOR_VERSION:-6.3.11}"
US_CORE_IG="${US_CORE_IG:-hl7.fhir.us.core#7.0.0}"
FHIR_VERSION="${FHIR_VERSION:-4.0.1}"

CACHE_DIR="${CACHE_DIR:-${HOME}/.cache/mbhr-fhir-validator}"
JAR_PATH="${CACHE_DIR}/validator_cli-${VALIDATOR_VERSION}.jar"
INPUT="${1:-e2e/fixtures/fhir/golden-bundle.json}"

if [ ! -f "${INPUT}" ]; then
  echo "input file not found: ${INPUT}" >&2
  exit 64
fi

if ! command -v java >/dev/null 2>&1; then
  echo "java not found on PATH; install Java 17+ to run the HL7 validator" >&2
  exit 69
fi

mkdir -p "${CACHE_DIR}"

if [ ! -f "${JAR_PATH}" ]; then
  echo ">>> downloading validator_cli ${VALIDATOR_VERSION}…" >&2
  curl -fL --retry 3 -o "${JAR_PATH}" \
    "https://github.com/hapifhir/org.hl7.fhir.core/releases/download/${VALIDATOR_VERSION}/validator_cli.jar"
fi

echo ">>> validating ${INPUT} against ${US_CORE_IG} (FHIR ${FHIR_VERSION})" >&2
exec java -jar "${JAR_PATH}" \
  -version "${FHIR_VERSION}" \
  -ig "${US_CORE_IG}" \
  -tx "https://tx.fhir.org" \
  "${INPUT}"
