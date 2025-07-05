// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract ShowUpEvent {

    struct Event {
        string name;
        uint256 date;
        uint256 stakeAmount;
        address creator;
        bool finalized;
        address[] participants;
        mapping(address => bool) hasStaked;
        mapping(address => bool) attended;
    }

    struct MemoryNFT {
        uint256 eventId;
        string imageUrl;
        string eventName;
        uint256 eventDate;
        address creator;
        uint256 tokenId;
    }

    mapping(uint256 => Event) public events;
    mapping(uint256 => MemoryNFT) public memoryNFTs; // tokenId => MemoryNFT
    mapping(uint256 => uint256[]) public eventMemories; // eventId => array of tokenIds
    uint256 public eventCount;
    uint256 public nftTokenId;

    event EventCreated(uint256 indexed eventId, string name, uint256 stakeAmount);
    event Joined(uint256 indexed eventId, address user);
    event AttendanceMarked(uint256 indexed eventId, address user);
    event Finalized(uint256 indexed eventId);
    event MemoryNFTMinted(uint256 indexed tokenId, uint256 indexed eventId, string imageUrl, address creator);

    modifier onlyCreator(uint256 eventId) {
        require(msg.sender == events[eventId].creator, "Only creator");
        _;
    }

    function createEvent(string memory name, uint256 date, uint256 stakeAmount) external returns (uint256) {
        eventCount++;
        Event storage e = events[eventCount];
        e.name = name;
        e.date = date;
        e.stakeAmount = stakeAmount;
        e.creator = msg.sender;

        emit EventCreated(eventCount, name, stakeAmount);
        return eventCount;
    }

    function joinEvent(uint256 eventId) external payable {
        Event storage e = events[eventId];
        require(!e.finalized, "Already finalized");
        require(!e.hasStaked[msg.sender], "Already joined");
        require(msg.value == e.stakeAmount, "Incorrect stake");

        e.participants.push(msg.sender);
        e.hasStaked[msg.sender] = true;

        emit Joined(eventId, msg.sender);
    }

     function markAttendance(uint256 eventId, address user) external onlyCreator(eventId) {
        Event storage e = events[eventId];
        require(e.hasStaked[user], "User did not join");

        e.attended[user] = true;

        emit AttendanceMarked(eventId, user);
    }

    function finalizeEvent(uint256 eventId) external onlyCreator(eventId) {
        Event storage e = events[eventId];
        require(!e.finalized, "Already finalized");

        uint256 totalPool = e.stakeAmount * e.participants.length;
        uint256 attendeeCount = 0;

        // Count attendees
        for (uint i = 0; i < e.participants.length; i++) {
            if (e.attended[e.participants[i]]) {
                attendeeCount++;
            }
        }

        require(attendeeCount > 0, "No one showed up!");

        uint256 rewardPerUser = totalPool / attendeeCount;

        // Distribute funds to attendees
        for (uint i = 0; i < e.participants.length; i++) {
            address user = e.participants[i];
            if (e.attended[user]) {
                (bool sent, ) = user.call{value: rewardPerUser}("");
                require(sent, "Failed to send reward");
            }
        }

        e.finalized = true;
        emit Finalized(eventId);
    }

    function mintMemoryNFT(uint256 eventId, string memory imageUrl) external {
        Event storage e = events[eventId];
        require(e.finalized, "Event must be finalized");
        require(e.hasStaked[msg.sender], "Must be event participant");
        
        nftTokenId++;
        
        MemoryNFT storage nft = memoryNFTs[nftTokenId];
        nft.eventId = eventId;
        nft.imageUrl = imageUrl;
        nft.eventName = e.name;
        nft.eventDate = e.date;
        nft.creator = msg.sender;
        nft.tokenId = nftTokenId;
        
        eventMemories[eventId].push(nftTokenId);
        
        emit MemoryNFTMinted(nftTokenId, eventId, imageUrl, msg.sender);
    }

    function getEventMemories(uint256 eventId) external view returns (uint256[] memory) {
        return eventMemories[eventId];
    }

    function getMemoryNFT(uint256 tokenId) external view returns (
        uint256 eventId,
        string memory imageUrl,
        string memory eventName,
        uint256 eventDate,
        address creator
    ) {
        MemoryNFT storage nft = memoryNFTs[tokenId];
        return (nft.eventId, nft.imageUrl, nft.eventName, nft.eventDate, nft.creator);
    }

    // Fallback to receive ETH
    receive() external payable {}
}

