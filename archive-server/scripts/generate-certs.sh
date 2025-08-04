#!/bin/bash

# Generate mTLS certificates for development
# This script creates a complete certificate chain for development and testing

set -e

CERTS_DIR="$(dirname "$0")/../certs"
mkdir -p "$CERTS_DIR"

echo "🔐 Generating mTLS certificates for Archive Server..."

# Certificate Authority (CA)
echo "📋 Creating Certificate Authority..."
openssl req -new -x509 -days 3650 -keyout "$CERTS_DIR/ca-key.pem" -out "$CERTS_DIR/ca-cert.pem" -nodes \
  -subj "/C=US/ST=CA/L=San Francisco/O=Engage2/OU=Archive/CN=Archive-CA"

# Server Certificate
echo "📋 Creating Server Certificate..."
openssl req -new -keyout "$CERTS_DIR/server-key.pem" -out "$CERTS_DIR/server.csr" -nodes \
  -subj "/C=US/ST=CA/L=San Francisco/O=Engage2/OU=Archive/CN=archive-server"

# Create server extensions file
cat > "$CERTS_DIR/server.ext" << EOF
authorityKeyIdentifier=keyid,issuer
basicConstraints=CA:FALSE
keyUsage = digitalSignature, nonRepudiation, keyEncipherment, dataEncipherment
subjectAltName = @alt_names

[alt_names]
DNS.1 = archive-server
DNS.2 = localhost
DNS.3 = archive.engage2.local
DNS.4 = 127.0.0.1
IP.1 = 127.0.0.1
IP.2 = ::1
EOF

# Sign server certificate
openssl x509 -req -in "$CERTS_DIR/server.csr" -CA "$CERTS_DIR/ca-cert.pem" -CAkey "$CERTS_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERTS_DIR/server-cert.pem" -days 365 -extensions v3_req -extfile "$CERTS_DIR/server.ext"

# Development Client Certificate
echo "📋 Creating Development Client Certificate..."
openssl req -new -keyout "$CERTS_DIR/dev-client-key.pem" -out "$CERTS_DIR/dev-client.csr" -nodes \
  -subj "/C=US/ST=CA/L=San Francisco/O=Engage2/OU=Archive/CN=engage2-dev-client"

openssl x509 -req -in "$CERTS_DIR/dev-client.csr" -CA "$CERTS_DIR/ca-cert.pem" -CAkey "$CERTS_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERTS_DIR/dev-client-cert.pem" -days 365

# Test Client Certificate
echo "📋 Creating Test Client Certificate..."
openssl req -new -keyout "$CERTS_DIR/test-client-key.pem" -out "$CERTS_DIR/test-client.csr" -nodes \
  -subj "/C=US/ST=CA/L=San Francisco/O=Engage2/OU=Archive/CN=engage2-test-client"

openssl x509 -req -in "$CERTS_DIR/test-client.csr" -CA "$CERTS_DIR/ca-cert.pem" -CAkey "$CERTS_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERTS_DIR/test-client-cert.pem" -days 365

# Production Client Certificate
echo "📋 Creating Production Client Certificate..."
openssl req -new -keyout "$CERTS_DIR/prod-client-key.pem" -out "$CERTS_DIR/prod-client.csr" -nodes \
  -subj "/C=US/ST=CA/L=San Francisco/O=Engage2/OU=Archive/CN=engage2-prod-client"

openssl x509 -req -in "$CERTS_DIR/prod-client.csr" -CA "$CERTS_DIR/ca-cert.pem" -CAkey "$CERTS_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERTS_DIR/prod-client-cert.pem" -days 365

# Admin Client Certificate
echo "📋 Creating Admin Client Certificate..."
openssl req -new -keyout "$CERTS_DIR/admin-client-key.pem" -out "$CERTS_DIR/admin-client.csr" -nodes \
  -subj "/C=US/ST=CA/L=San Francisco/O=Engage2/OU=Archive/CN=engage2-admin-client"

openssl x509 -req -in "$CERTS_DIR/admin-client.csr" -CA "$CERTS_DIR/ca-cert.pem" -CAkey "$CERTS_DIR/ca-key.pem" \
  -CAcreateserial -out "$CERTS_DIR/admin-client-cert.pem" -days 365

# Clean up CSR files
rm -f "$CERTS_DIR"/*.csr "$CERTS_DIR/server.ext"

# Set proper permissions
chmod 600 "$CERTS_DIR"/*-key.pem
chmod 644 "$CERTS_DIR"/*-cert.pem "$CERTS_DIR/ca-cert.pem"

echo "✅ Certificates generated successfully!"
echo ""
echo "📁 Certificate files created in: $CERTS_DIR"
echo "   - ca-cert.pem (Certificate Authority)"
echo "   - server-cert.pem + server-key.pem (Server)"
echo "   - dev-client-cert.pem + dev-client-key.pem (Development Client)"
echo "   - test-client-cert.pem + test-client-key.pem (Test Client)"
echo "   - prod-client-cert.pem + prod-client-key.pem (Production Client)"
echo "   - admin-client-cert.pem + admin-client-key.pem (Admin Client)"
echo ""
echo "🔒 Server will validate client certificates using the CA certificate"
echo "🔑 Clients must present valid certificates signed by the CA"
echo ""
echo "⚠️  Note: These are development certificates. For production:"
echo "   1. Use proper certificate management (Let's Encrypt, corporate CA)"
echo "   2. Store private keys securely (HSM, key management service)"
echo "   3. Implement certificate rotation"
echo "   4. Use proper DNS names and IP addresses"