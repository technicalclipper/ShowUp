# 🪧 ShowUp - Let's Meet

> **Turning your group plans into proof-backed memories — directly from Telegram.**

[![Telegram Bot](https://img.shields.io/badge/Telegram-Bot-blue?logo=telegram)](https://t.me/Leeeeeets_meet_bot)
[![Blockchain](https://img.shields.io/badge/Blockchain-Flow-blue?logo=flow)](https://flow.com)
[![Zircuit](https://img.shields.io/badge/Zircuit-Layer2-purple?logo=zircuit)](https://zircuit.com)
[![AI](https://img.shields.io/badge/AI-OpenAI-green?logo=openai)](https://openai.com)

## 📜 Overview

ShowUp is a Telegram-native Web3 event coordination bot that transforms casual group plans into verifiable, stake-powered commitments. Using blockchain staking, live attendance proof, and AI-generated memory posters, ShowUp turns group chats into trustless event DAOs.

**No more "bro sorry, I slept 😴"** - "Let's Meet" ensures people actually show up to events!

## 🎯 Problem Solved

> "Let's go to Goa bro" — but the plan dies in WhatsApp.

People flake on group plans because there's no commitment or consequence. This breaks trust and wastes time.

**ShowUp solves this using:**
- **Staked intent**: Pay to commit. Get it back only if you attend
- **Bot-powered coordination** inside Telegram groups
- **Location + photo proof** to mark attendance
- **On-chain reward splitting** to attendees
- **AI-generated memory posters**, stored in decentralized storage (Walrus)

## ✨ Features

### 🎉 Event Management
- **Create Events**: Set up events with stake amounts and locations
- **Join Events**: Commit to events by staking tokens
- **Swipeable UI**: Easy navigation through events with Previous/Next buttons
- **Event Categories**: Browse all events, available events, or joined events

### 📍 Attendance Verification
- **Location-based Proof**: Verify attendance within 200 meters of event location
- **Real-time Check-in**: Mark attendance using Telegram location sharing
- **Blockchain Verification**: All attendance records stored on-chain

### 🎨 Memory Creation
- **AI-Enhanced Posters**: Transform group photos into beautiful memory posters
- **OpenAI Integration**: Uses GPT-Image-1 for creative photo enhancement
- **Decentralized Storage**: Store memories on Walrus (IPFS-compatible)
- **NFT Minting**: Mint memories as NFTs on the blockchain

### 💰 Reward System
- **Stake & Earn**: Stake tokens to join, earn rewards for attending
- **Automatic Distribution**: Rewards automatically split among attendees
- **Transparent Payouts**: All transactions visible on blockchain

### 📊 Analytics & Insights
- **Personal Statistics**: Track events created, joined, and attended
- **Event Summaries**: Detailed attendance reports for finalized events
- **Achievement System**: Unlock achievements based on participation

## 🛠️ Tech Stack

### Blockchain & Web3
- **Smart Contracts**: Cadence contracts on Flow blockchain
- **Flow SDK**: Flow blockchain interactions and transactions
- **Zircuit**: Layer 2 scaling solution for enhanced performance
- **Flow CLI**: Development and deployment tools

### AI & Storage
- **OpenAI GPT-Image-1**: AI-powered image editing for memory posters
- **Walrus**: Decentralized storage for images and data
- **Canvas**: Image processing and manipulation

### Backend & Database
- **Node.js**: Server-side JavaScript runtime
- **Telegram Bot API**: Bot framework for Telegram integration
- **Supabase**: PostgreSQL database with real-time features
- **Sharp**: Image compression and optimization

### Infrastructure
- **Environment Variables**: Secure configuration management
- **Error Handling**: Comprehensive error management and logging
- **State Management**: In-memory state tracking for user flows

## 🚀 Quick Start

### 1. Add Bot to Your Group
```
https://t.me/Leeeeeets_meet_bot
```

### 2. Create Your Wallet
```
/create_wallet
```

### 3. Start Planning Events
```
/create_event
```

## 📱 Full User Flow

### 🎯 Event Creation Flow
1. **Start Creation**: `/create_event`
2. **Event Name**: Enter a descriptive name
3. **Date & Time**: Use format `YYYY-MM-DD HH:MM`
4. **Stake Amount**: Set how much participants must stake
5. **Location**: Share location via Telegram or enter manually
6. **Confirmation**: Event created on blockchain with transaction hash

### 🎉 Event Participation Flow
1. **Browse Events**: `/events` or `/join_event`
2. **Select Event**: Choose from available events
3. **Confirm Stake**: Review stake amount and confirm
4. **Join Event**: Pay stake and become participant
5. **Wait for Event**: Get ready to attend!

### 📍 Attendance Confirmation Flow
1. **Check Joined Events**: `/confirm_attendance`
2. **Select Event**: Choose event to confirm attendance
3. **Share Location**: Use Telegram location sharing
4. **Distance Check**: Bot verifies you're within 200m
5. **Attendance Marked**: Blockchain transaction confirms attendance

### 🎨 Memory Creation Flow
1. **Create Memory**: `/create_memory`
2. **Select Event**: Choose event for memory
3. **Upload Photo**: Send iconic group photo
4. **AI Enhancement**: Bot creates beautiful memory poster
5. **Store on Walrus**: Image saved to decentralized storage
6. **Mint NFT** (Optional): Create blockchain NFT of memory

### 🏁 Event Finalization Flow
1. **End Event**: `/end_event` (creators only)
2. **Select Event**: Choose event to finalize
3. **Automatic Payouts**: Rewards distributed to attendees
4. **Event Summary**: Detailed attendance report generated

### 📊 Analytics & Memories
- **View Stats**: `/stats` - Personal statistics and achievements
- **Event Summary**: `/event_summary` - Detailed attendance reports
- **Show Memories**: `/show_memory` - View AI-enhanced memory posters

## 🔧 Setup & Development

### Prerequisites
- Node.js 18+
- Telegram Bot Token
- OpenAI API Key
- Supabase Account
- Flow Network Access
- Flow Account and Private Key

### Environment Variables
```env
# Telegram
token=YOUR_TELEGRAM_BOT_TOKEN

# Blockchain
CONTRACT_ADDRESS=YOUR_CONTRACT_ADDRESS
PRIVATE_KEY=YOUR_BOT_PRIVATE_KEY
RPC_URL=YOUR_SEPOLIA_RPC_URL

# Database
SUPABASE_URL=YOUR_SUPABASE_URL
SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY

# AI
OPENAI_API_KEY=YOUR_OPENAI_API_KEY

# Customization
TOKENNAME=FLOW
CHAINNAME=flow-testnet
```

### Installation
```bash
# Clone repository
git clone <repository-url>
cd Meet_Up

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your values

# Start the bot
nodemon index.js
```

### Database Schema
The project uses Supabase with the following tables:
- `users`: User wallets and Telegram IDs
- `events`: Event details and blockchain data
- `participants`: Event participation and attendance
- `memory_posters`: AI-enhanced memory images

## 🎨 Smart Contract Features

### EventManager.sol
- **Event Creation**: Create events with stake amounts
- **Event Joining**: Stake tokens to join events
- **Attendance Marking**: Verify and mark attendance
- **Event Finalization**: Distribute rewards to attendees
- **NFT Minting**: Mint memory NFTs with image URLs

### Key Functions
- `createEvent()`: Create new events
- `joinEvent()`: Join events with stake
- `markAttendance()`: Mark user attendance
- `finalizeEvent()`: End events and distribute rewards
- `mintMemoryNFT()`: Create NFTs from memories

## 🌐 Deployment

### Live Bot
- **Bot Link**: https://t.me/Leeeeeets_meet_bot
- **Network**: Flow Testnet
- **Layer 2**: Zircuit for enhanced performance
- **Storage**: Walrus Decentralized Storage
- **AI**: OpenAI GPT-Image-1

### Add to Group Chat
1. Click the bot link above
2. Start the bot with `/start`
3. Add bot to your group chat
4. Use `/help` to see all commands
5. Start creating events!

## 🎯 Use Cases

### 🏖️ Travel & Trips
- Plan group vacations with staked commitments
- Ensure everyone shows up for the trip
- Create beautiful memory posters from travel photos

### 🍽️ Dining & Social
- Organize group dinners with attendance guarantees
- Split bills fairly among attendees
- Preserve dining memories as NFTs

### 🎉 Events & Parties
- Plan birthday parties with committed guests
- Verify attendance for exclusive events
- Create lasting memories from celebrations

### 💼 Business & Networking
- Organize meetups with professional commitments
- Track attendance for networking events
- Build reputation through consistent attendance

## 🔒 Security & Privacy

- **Private Keys**: Stored securely in nillion secure vault
- **Location Data**: Only used for attendance verification
- **Blockchain**: All transactions are transparent and verifiable
- **Decentralized Storage**: Images stored on Walrus for privacy

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

- **Bot Issues**: Contact via Telegram bot
- **Technical Support**: Open an issue on GitHub
- **Feature Requests**: Submit via GitHub issues

---

**Made with ❤️ for better group coordination and lasting memories**

*ShowUp - Where plans become commitments, and memories become NFTs*
