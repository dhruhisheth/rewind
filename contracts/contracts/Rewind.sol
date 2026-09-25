// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Rewind — an undo button for on-chain payments
/// @notice Payments sit in a short "rewind window" before they settle. During the
///         window the sender can pull the payment back (wrong address, scam, fat
///         finger) and the recipient can bounce it. The window is not fixed: it
///         adapts to the relationship between sender and recipient and to the
///         recipient's public rewind history, so trusted payees get paid instantly
///         while addresses that keep getting rewound get held longer for everyone.
contract Rewind is ReentrancyGuard {
    using SafeERC20 for IERC20;

    enum Status {
        None,
        Pending,
        Claimed, // settled to recipient after the window
        Released, // sender confirmed early
        Rewound, // sender pulled it back
        Refused // recipient bounced it
    }

    struct Payment {
        address sender;
        address recipient;
        address token; // address(0) = native ETH
        uint256 amount;
        uint64 createdAt;
        uint64 unlockAt;
        Status status;
        string memo;
    }

    struct Reputation {
        uint32 settled; // payments that settled to this address
        uint32 rewinds; // payments to this address that senders rewound
        uint32 distinctRewinders; // unique senders who rewound a payment to it
        uint32 refused; // payments this address honestly bounced back
    }

    /// @notice Settled payments from sender to recipient needed before payments become instant.
    uint32 public constant TRUST_THRESHOLD = 3;
    /// @notice Hard cap on any rewind window.
    uint64 public constant MAX_WINDOW = 7 days;

    /// @notice Window applied to a first-time recipient with a clean record.
    uint64 public immutable baseWindow;

    uint256 public paymentCount;
    mapping(uint256 => Payment) private _payments;
    mapping(address => uint256[]) private _outgoing;
    mapping(address => uint256[]) private _incoming;

    mapping(address => Reputation) private _reputation;
    mapping(address => mapping(address => bool)) private _hasRewound; // recipient => sender => bool
    /// @notice sender => recipient => number of payments that settled between them.
    mapping(address => mapping(address => uint32)) public settledBetween;

    event PaymentSent(
        uint256 indexed id,
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint64 unlockAt,
        string memo
    );
    event PaymentSettled(uint256 indexed id, Status status);
    event PaymentRewound(uint256 indexed id, address indexed recipient);
    event PaymentRefused(uint256 indexed id, address indexed recipient);

    error InvalidRecipient();
    error InvalidAmount();
    error NotPending();
    error NotSender();
    error NotRecipient();
    error WindowClosed();
    error WindowOpen();
    error EthTransferFailed();

    constructor(uint64 baseWindow_) {
        require(baseWindow_ > 0 && baseWindow_ <= MAX_WINDOW, "bad window");
        baseWindow = baseWindow_;
    }

    // ------------------------------------------------------------------ views

    /// @notice The rewind window a payment from `sender` to `recipient` would get right now.
    /// @dev    0 when the pair is trusted. Otherwise baseWindow, multiplied by
    ///         (1 + number of distinct senders who have rewound on this recipient),
    ///         capped at MAX_WINDOW. A recipient with a bad record can't reach
    ///         "trusted" status with a sender who has rewound on them.
    function windowFor(address sender, address recipient) public view returns (uint64) {
        if (settledBetween[sender][recipient] >= TRUST_THRESHOLD && !_hasRewound[recipient][sender]) {
            return 0;
        }
        uint256 w = uint256(baseWindow) * (1 + _reputation[recipient].distinctRewinders);
        return w > MAX_WINDOW ? MAX_WINDOW : uint64(w);
    }

    function getPayment(uint256 id) external view returns (Payment memory) {
        return _payments[id];
    }

    function reputationOf(address account) external view returns (Reputation memory) {
        return _reputation[account];
    }

    function outgoingOf(address account) external view returns (uint256[] memory) {
        return _outgoing[account];
    }

    function incomingOf(address account) external view returns (uint256[] memory) {
        return _incoming[account];
    }

    // -------------------------------------------------------------- mutations

    /// @notice Send a rewindable payment.
    /// @param recipient    who gets paid
    /// @param token        ERC-20 address, or address(0) for ETH (then send value)
    /// @param amount       amount for ERC-20 payments; ignored for ETH
    /// @param minWindow    sender can ask for a longer window than the adaptive one
    /// @param memo         free-text note stored with the payment
    function send(address recipient, address token, uint256 amount, uint64 minWindow, string calldata memo)
        external
        payable
        nonReentrant
        returns (uint256 id)
    {
        if (recipient == address(0) || recipient == msg.sender || recipient == address(this)) {
            revert InvalidRecipient();
        }

        if (token == address(0)) {
            amount = msg.value;
        } else {
            if (msg.value != 0) revert InvalidAmount();
            // measure what actually arrived, so fee-on-transfer tokens can't overdraw the vault
            uint256 before = IERC20(token).balanceOf(address(this));
            IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
            amount = IERC20(token).balanceOf(address(this)) - before;
        }
        if (amount == 0) revert InvalidAmount();

        uint64 window = windowFor(msg.sender, recipient);
        if (minWindow > window) window = minWindow > MAX_WINDOW ? MAX_WINDOW : minWindow;

        id = ++paymentCount;
        uint64 now_ = uint64(block.timestamp);
        _payments[id] = Payment({
            sender: msg.sender,
            recipient: recipient,
            token: token,
            amount: amount,
            createdAt: now_,
            unlockAt: now_ + window,
            status: Status.Pending,
            memo: memo
        });
        _outgoing[msg.sender].push(id);
        _incoming[recipient].push(id);

        emit PaymentSent(id, msg.sender, recipient, token, amount, now_ + window, memo);

        // trusted pair: settle in the same transaction
        if (window == 0) _settle(id, Status.Claimed);
    }

    /// @notice Sender pulls a pending payment back before its window closes.
    function rewind(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (msg.sender != p.sender) revert NotSender();
        if (block.timestamp >= p.unlockAt) revert WindowClosed();

        p.status = Status.Rewound;
        Reputation storage r = _reputation[p.recipient];
        r.rewinds += 1;
        if (!_hasRewound[p.recipient][p.sender]) {
            _hasRewound[p.recipient][p.sender] = true;
            r.distinctRewinders += 1;
        }

        emit PaymentRewound(id, p.recipient);
        emit PaymentSettled(id, Status.Rewound);
        _pay(p.token, p.sender, p.amount);
    }

    /// @notice Recipient bounces a payment they shouldn't have received. Honest
    ///         bounces are recorded in the recipient's favour, not against them.
    function refuse(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (msg.sender != p.recipient) revert NotRecipient();

        p.status = Status.Refused;
        _reputation[p.recipient].refused += 1;

        emit PaymentRefused(id, p.recipient);
        emit PaymentSettled(id, Status.Refused);
        _pay(p.token, p.sender, p.amount);
    }

    /// @notice Sender confirms early (e.g. goods received) and releases funds now.
    function release(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (msg.sender != p.sender) revert NotSender();
        _settle(id, Status.Released);
    }

    /// @notice Anyone can settle a payment once its window has closed.
    function claim(uint256 id) external nonReentrant {
        Payment storage p = _pending(id);
        if (block.timestamp < p.unlockAt) revert WindowOpen();
        _settle(id, Status.Claimed);
    }

    // --------------------------------------------------------------- internal

    function _pending(uint256 id) private view returns (Payment storage p) {
        p = _payments[id];
        if (p.status != Status.Pending) revert NotPending();
    }

    function _settle(uint256 id, Status status) private {
        Payment storage p = _payments[id];
        p.status = status;
        _reputation[p.recipient].settled += 1;
        settledBetween[p.sender][p.recipient] += 1;
        emit PaymentSettled(id, status);
        _pay(p.token, p.recipient, p.amount);
    }

    function _pay(address token, address to, uint256 amount) private {
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert EthTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
    }
}
