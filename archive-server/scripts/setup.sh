#!/bin/bash

# Setup script for Archive Server development environment

set -e

echo "🚀 Setting up Archive Server development environment..."

# Check dependencies
echo "🔍 Checking dependencies..."

# Check Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18 or later."
    exit 1
fi

NODE_VERSION=$(node --version | cut -d'v' -f2)
REQUIRED_VERSION="18.0.0"

if ! node -e "process.exit(require('semver').gte('$NODE_VERSION', '$REQUIRED_VERSION') ? 0 : 1)" 2>/dev/null; then
    echo "❌ Node.js version $NODE_VERSION is too old. Please upgrade to version $REQUIRED_VERSION or later."
    exit 1
fi

echo "✅ Node.js version $NODE_VERSION is compatible"

# Check Docker and Docker Compose
if command -v docker &> /dev/null && command -v docker-compose &> /dev/null; then
    echo "✅ Docker and Docker Compose are available"
    DOCKER_AVAILABLE=true
else
    echo "⚠️  Docker not available - will use local setup"
    DOCKER_AVAILABLE=false
fi

# Check PostgreSQL (for local development)
if command -v psql &> /dev/null; then
    echo "✅ PostgreSQL client is available"
    POSTGRES_CLIENT_AVAILABLE=true
else
    echo "⚠️  PostgreSQL client not available - using Docker PostgreSQL"
    POSTGRES_CLIENT_AVAILABLE=false
fi

# Create necessary directories
echo "📁 Creating directory structure..."
mkdir -p logs certs scripts/sql

# Install dependencies
echo "📦 Installing Node.js dependencies..."
npm install

# Generate development certificates
echo "🔐 Generating development certificates..."
./scripts/generate-certs.sh

# Create environment file
if [ ! -f .env ]; then
    echo "⚙️  Creating environment configuration..."
    cp .env.example .env
    echo "✅ Created .env file - please review and update as needed"
else
    echo "✅ Environment file already exists"
fi

# Setup database
echo "🗄️  Setting up database..."

if [ "$DOCKER_AVAILABLE" = true ]; then
    echo "🐳 Using Docker for database setup..."
    
    # Start PostgreSQL container
    docker-compose up -d postgres
    
    # Wait for PostgreSQL to be ready
    echo "⏳ Waiting for PostgreSQL to be ready..."
    timeout=60
    while [ $timeout -gt 0 ]; do
        if docker-compose exec postgres pg_isready -U postgres -d engage2_archive_dev > /dev/null 2>&1; then
            break
        fi
        sleep 1
        ((timeout--))
    done
    
    if [ $timeout -eq 0 ]; then
        echo "❌ PostgreSQL failed to start within 60 seconds"
        exit 1
    fi
    
    echo "✅ PostgreSQL is ready"
    
    # Run migrations
    echo "🔄 Running database migrations..."
    npm run migrate
    
else
    echo "⚠️  Docker not available - please ensure PostgreSQL is running locally"
    echo "   Database: engage2_archive_dev"
    echo "   User: postgres"
    echo "   Password: password (or update .env file)"
    echo ""
    echo "   Run migrations manually with: npm run migrate"
fi

# Create systemd service file (Linux only)
if command -v systemctl &> /dev/null; then
    echo "🔧 Creating systemd service file..."
    
    cat > archive-server.service << EOF
[Unit]
Description=Engage2 Archive Server
After=network.target postgresql.service

[Service]
Type=simple
User=\$USER
WorkingDirectory=$(pwd)
Environment=NODE_ENV=production
ExecStart=$(which node) src/server.js
Restart=always
RestartSec=10

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ReadWritePaths=$(pwd)/logs
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

    echo "✅ Systemd service file created: archive-server.service"
    echo "   To install: sudo cp archive-server.service /etc/systemd/system/"
    echo "   To enable: sudo systemctl enable archive-server"
    echo "   To start: sudo systemctl start archive-server"
fi

# Create development scripts
echo "📝 Creating development scripts..."

# Development start script
cat > scripts/dev.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting Archive Server in development mode..."
export NODE_ENV=development
npm run dev
EOF

# Production start script
cat > scripts/prod.sh << 'EOF'
#!/bin/bash
echo "🚀 Starting Archive Server in production mode..."
export NODE_ENV=production
npm start
EOF

# Test script
cat > scripts/test.sh << 'EOF'
#!/bin/bash
echo "🧪 Running Archive Server tests..."
export NODE_ENV=test
npm test
EOF

# Docker development script
cat > scripts/docker-dev.sh << 'EOF'
#!/bin/bash
echo "🐳 Starting Archive Server with Docker..."
docker-compose up --build
EOF

# Make scripts executable
chmod +x scripts/*.sh

echo ""
echo "🎉 Archive Server setup completed successfully!"
echo ""
echo "📋 Next steps:"
echo "   1. Review and update .env file with your configuration"
echo "   2. Start development server:"
echo "      • Local: npm run dev"
echo "      • Docker: ./scripts/docker-dev.sh"
echo "   3. Test the setup:"
echo "      • Health check: curl -k https://localhost:3443/health"
echo "      • API info: curl -k https://localhost:3443/api/info"
echo "   4. View logs in ./logs directory"
echo ""
echo "🔒 Security notes:"
echo "   • Development certificates are in ./certs directory"
echo "   • Client certificates are required for API access"
echo "   • Review mTLS configuration for production deployment"
echo ""
echo "📚 Documentation:"
echo "   • README.md - Complete setup and usage guide"
echo "   • API documentation available after starting server"
echo ""

if [ "$DOCKER_AVAILABLE" = true ]; then
    echo "🐳 Docker commands:"
    echo "   • Start services: docker-compose up -d"
    echo "   • View logs: docker-compose logs -f"
    echo "   • Stop services: docker-compose down"
    echo ""
fi