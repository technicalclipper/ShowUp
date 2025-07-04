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

    mapping(uint256 => Event) public events;
    uint256 public eventCount;

    event EventCreated(uint256 indexed eventId, string name, uint256 stakeAmount);
    event Joined(uint256 indexed eventId, address user);
    event AttendanceMarked(uint256 indexed eventId, address user);
    event Finalized(uint256 indexed eventId);

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

    

    // Fallback to receive ETH
    receive() external payable {}
}

