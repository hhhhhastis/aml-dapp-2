// SPDX-License-Identifier: MIT
pragma solidity >=0.5.0 <0.9.0;

interface IERC20 {
    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function transfer(address recipient, uint256 amount) external returns (bool); // ← добавили
}

contract AMLPayment {
    address public owner;
    IERC20 public usdt;
    uint256 public feeAmount;

    event PaymentReceived(address indexed user, uint256 amount, uint256 timestamp);

    constructor(address _usdt, uint256 _feeAmount) {
        owner = msg.sender;
        usdt = IERC20(_usdt);
        feeAmount = _feeAmount;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    function pay(address user) external {
        uint256 allowance = usdt.allowance(user, address(this));
        require(allowance >= feeAmount, "Insufficient allowance");
        bool success = usdt.transferFrom(user, owner, feeAmount);
        require(success, "Transfer failed");
        emit PaymentReceived(user, feeAmount, block.timestamp);
    }

    function getAllowance(address user) external view returns (uint256) {
        return usdt.allowance(user, address(this));
    }

    function setFee(uint256 _newFee) external onlyOwner {
        feeAmount = _newFee;
    }

    function withdrawTokens(address token, uint256 amount) external onlyOwner {
        IERC20(token).transfer(owner, amount); // теперь работает
    }
}