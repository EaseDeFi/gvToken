/// SPDX-License-Identifier: UNLICENSED

pragma solidity 0.8.11;

import "../external/SolmateERC20.sol";

contract EaseToken is SolmateERC20 {
    constructor() SolmateERC20("Ease Token", "EASE", 18) {
        _mint(msg.sender, 750_000_000e18);
    }

    function burn(uint256 _amount) external {
        _burn(msg.sender, _amount);
    }
}
