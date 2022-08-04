/// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IEaseToken.sol";
import "../interfaces/IVArmor.sol";

contract TokenSwap {
    IEaseToken public immutable ease;
    IERC20 public immutable armor;
    IVArmor public immutable vArmor;

    constructor(
        address _ease,
        address _armor,
        address _vArmor
    ) {
        ease = IEaseToken(_ease);
        armor = IERC20(_armor);
        vArmor = IVArmor(_vArmor);
    }

    function swap(uint256 amount) external {
        ease.mint(msg.sender, amount);
        armor.transferFrom(msg.sender, address(0xdEaD), amount);
    }

    function swapVArmor(uint256 amount) external {
        // TODO: can we fix conversion rate at certain period in time to make this cheaper?
        uint256 armorAmount = vArmor.vArmorToArmor(amount);
        ease.mint(msg.sender, armorAmount);
        vArmor.transferFrom(msg.sender, address(0xdEaD), amount);
    }
}
