/// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.11;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "../interfaces/IEaseToken.sol";
import "../interfaces/IVArmor.sol";

contract TokenSwap {
    address private constant DEAD = address(0xdEaD);
    IEaseToken public immutable ease;
    IERC20 public immutable armor;
    IVArmor public immutable vArmor;
    string public name = "Ease Token Swap";

    constructor(
        address ease_,
        address armor_,
        address vArmor_
    ) {
        ease = IEaseToken(ease_);
        armor = IERC20(armor_);
        vArmor = IVArmor(vArmor_);
    }

    function swap(uint256 amount) external {
        _swap(msg.sender, amount);
    }

    function swapFor(address user, uint256 amount) external {
        _swap(user, amount);
    }

    function swapVArmor(uint256 amount) external {
        _swapVArmor(msg.sender, amount);
    }

    function swapVArmorFor(address user, uint256 amount) external {
        _swapVArmor(user, amount);
    }

    function _swap(address user, uint256 amount) internal {
        ease.transfer(user, amount);
        armor.transferFrom(user, DEAD, amount);
    }

    function _swapVArmor(address user, uint256 amount) internal {
        uint256 armorAmount = vArmor.vArmorToArmor(amount);
        ease.transfer(user, armorAmount);
        vArmor.transferFrom(user, DEAD, amount);
    }
}
