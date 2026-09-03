// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Test } from "forge-std/Test.sol";
import { IAccessControl } from "@openzeppelin/contracts/access/IAccessControl.sol";
import { ZeroAddress } from "../src/PegShieldTypes.sol";
import { TestUSD } from "../src/TestUSD.sol";

contract TestUSDTest is Test {
    TestUSD private token;
    address private admin = address(0xA11CE);
    address private operator = address(0xB0B);
    address private user = address(0xCAFE);

    function setUp() public {
        token = new TestUSD(admin);
    }

    function test_metadataAndSixDecimals() public view {
        assertEq(token.name(), "PegShield Test USD");
        assertEq(token.symbol(), "tUSD");
        assertEq(token.decimals(), 6);
        assertTrue(token.hasRole(token.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(token.hasRole(token.MINTER_ROLE(), admin));
    }

    function test_adminCanGrantAndOperatorCanMint() public {
        bytes32 minterRole = token.MINTER_ROLE();
        vm.prank(admin);
        token.grantRole(minterRole, operator);

        vm.prank(operator);
        token.mint(user, 123_456);

        assertEq(token.balanceOf(user), 123_456);
        assertEq(token.totalSupply(), 123_456);
    }

    function test_nonMinterCannotMint() public {
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, user, token.MINTER_ROLE()
            )
        );
        vm.prank(user);
        token.mint(user, 1);
    }

    function test_zeroAdminRejected() public {
        vm.expectRevert(ZeroAddress.selector);
        new TestUSD(address(0));
    }
}
