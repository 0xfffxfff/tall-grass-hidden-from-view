// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import "solady/utils/Base64.sol";
import "solady/utils/LibString.sol";

library Metadata {
    string constant JSON_BASE64_HEADER = "data:application/json;base64,";

    /// @notice String values (name, description) must not contain ", \, or control characters.
    ///         No escaping is performed — invalid characters will produce broken JSON.
    function encodeMetadata(
        uint256 _tokenId,
        string memory _name,
        string memory _description,
        string memory _attributes,
        string memory _animationUrl
    ) internal pure returns (string memory) {
        string memory metadata = string.concat(
            "{",
            keyValue("tokenId", LibString.toString(_tokenId)),
            ",",
            keyValue("name", _name),
            ",",
            keyValue("description", _description),
            ",",
            keyValueNoQuotes("attributes", _attributes),
            ",",
            keyValue("animation_url", _animationUrl),
            "}"
        );

        return _encodeJSON(metadata);
    }

    /// @notice Token metadata with both `image` (preview) and `animation_url`
    ///         (interactive viewer). Either may be the empty string.
    function encodeTokenMetadata(
        uint256 _tokenId,
        string memory _name,
        string memory _description,
        string memory _attributes,
        string memory _image,
        string memory _animationUrl
    ) internal pure returns (string memory) {
        string memory metadata = string.concat(
            "{",
            keyValue("tokenId", LibString.toString(_tokenId)),
            ",",
            keyValue("name", _name),
            ",",
            keyValue("description", _description),
            ",",
            keyValueNoQuotes("attributes", _attributes),
            ",",
            keyValue("image", _image),
            ",",
            keyValue("animation_url", _animationUrl),
            "}"
        );

        return _encodeJSON(metadata);
    }

    /// @notice String values must not contain ", \, or control characters.
    ///         No escaping is performed — invalid characters will produce broken JSON.
    function encodeContractMetadata(
        string memory _name,
        string memory _symbol,
        string memory _description,
        string memory _image,
        string memory _externalLink
    ) internal pure returns (string memory) {
        string memory metadata = string.concat(
            "{",
            keyValue("name", _name),
            ",",
            keyValue("symbol", _symbol),
            ",",
            keyValue("description", _description),
            ",",
            keyValue("image", _image),
            ",",
            keyValue("external_link", _externalLink),
            "}"
        );

        return _encodeJSON(metadata);
    }

    function _encodeJSON(string memory _json) internal pure returns (string memory) {
        return string.concat(JSON_BASE64_HEADER, Base64.encode(bytes(_json)));
    }

    function keyValue(string memory _key, string memory _value) internal pure returns (string memory) {
        return string.concat('"', _key, '":"', _value, '"');
    }

    function keyValueNoQuotes(string memory _key, string memory _value) internal pure returns (string memory) {
        return string.concat('"', _key, '":', _value);
    }

    function attribute(string memory traitType, string memory value) internal pure returns (string memory) {
        return
            string.concat("{", keyValue("trait_type", traitType), ",", keyValue("value", value), "}");
    }

    function attributeNoQuotes(string memory traitType, string memory value) internal pure returns (string memory) {
        return string.concat(
            "{", keyValue("trait_type", traitType), ",", keyValueNoQuotes("value", value), "}"
        );
    }
}
