// SPDX-License-Identifier: GPL-3.0
pragma solidity ^0.8.28;

import {ERC721} from "solady/tokens/ERC721.sol";
import {OwnableRoles} from "solady/auth/OwnableRoles.sol";
import {ECDSA} from "solady/utils/ECDSA.sol";
import {MerkleProofLib} from "solady/utils/MerkleProofLib.sol";
import {IVerifier} from "./interfaces/IVerifier.sol";
import {ITallGrassMetadata} from "./interfaces/ITallGrassMetadata.sol";
import {Roles} from "./libraries/Roles.sol";

contract TallGrass is ERC721, OwnableRoles {
    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error AlreadyRegistered();
    error NotRegistered();
    error InvalidSignature();
    error NotEntityOwner();
    error EntityNotMinted();
    error EntityAlreadyMinted();
    error InvalidProof();
    error InvalidTraitProof();
    error IncorrectPayment();
    error InsufficientDeposit();
    error WithdrawFailed();
    error ReimbursementFailed();

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event Registered(address indexed participant, bytes32 positionCommitment);
    event Moved(address indexed participant, bytes32 newCommitment, uint256 moveCounter);
    event EntityMoved(uint256 indexed entityId, bytes32 directionCommitment, uint256 moveCounter);
    event Minted(address indexed participant, uint256 indexed entityId, uint256 moveCounter, bytes32 entityTraitCID);
    event Deposited(address indexed participant, uint256 amount, uint256 totalBalance);
    event DepositWithdrawn(address indexed participant, uint256 amount);
    event DepositDepleted(address indexed participant);
    event MintPriceUpdated(uint256 oldPrice, uint256 newPrice);

    // ERC-4906
    event MetadataUpdate(uint256 _tokenId);
    event BatchMetadataUpdate(uint256 _fromTokenId, uint256 _toTokenId);

    // ERC-7572
    event ContractURIUpdated();

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    uint256 public constant EDITOR = Roles.EDITOR;
    uint256 public constant ORACLE = Roles.ORACLE;
    uint256 public constant GAS_OVERHEAD = 50_000;

    // -----------------------------------------------------------------------
    // Immutables (set at deployment)
    // -----------------------------------------------------------------------

    bytes32 public immutable seedCommitment;
    bytes32 public immutable terrainMerkleRoot;
    bytes32 public immutable entityTraitMerkleRoot;
    uint256 public immutable gridWidth;
    uint256 public immutable gridHeight;
    uint256 public immutable totalSupply;
    uint256 public mintPrice;
    IVerifier public immutable movementVerifier;
    IVerifier public immutable entityMovementVerifier;
    IVerifier public immutable encounterVerifier;
    bytes32 public immutable entityMerkleRoot;
    bytes32 public immutable decryptionKeyCommitment;

    // -----------------------------------------------------------------------
    // Mutable state
    // -----------------------------------------------------------------------

    uint256 public moveCounter;
    uint256 public totalMinted;

    // Metadata delegation
    address public metadataContract;

    // Participant state
    mapping(address => bytes32) public positionCommitments;
    mapping(address => uint256) public participantMoveCount;
    mapping(address => bool) public isParticipant;

    // Entity state
    mapping(uint256 => bool) public entityMinted;
    mapping(uint256 => bytes32) public entityTraitCID;
    mapping(uint256 => bytes32) public entityPositionCommitments;
    mapping(uint256 => bytes32) public entityBlindingSeedCommitments;
    mapping(uint256 => uint256) public entityMoveCount;
    mapping(uint256 => address) public eP;

    // Deposit state
    mapping(address => uint256) public depositBalance;
    uint256 public totalDeposits;

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    constructor(
        bytes32 _seedCommitment,
        bytes32 _terrainMerkleRoot,
        bytes32 _entityTraitMerkleRoot,
        bytes32 _entityMerkleRoot,
        uint256 _gridWidth,
        uint256 _gridHeight,
        uint256 _totalSupply,
        uint256 _mintPrice,
        address _movementVerifier,
        address _entityMovementVerifier,
        address _encounterVerifier,
        bytes32 _decryptionKeyCommitment,
        address _owner
    ) {
        seedCommitment = _seedCommitment;
        terrainMerkleRoot = _terrainMerkleRoot;
        entityTraitMerkleRoot = _entityTraitMerkleRoot;
        entityMerkleRoot = _entityMerkleRoot;
        gridWidth = _gridWidth;
        gridHeight = _gridHeight;
        totalSupply = _totalSupply;
        mintPrice = _mintPrice;
        movementVerifier = IVerifier(_movementVerifier);
        entityMovementVerifier = IVerifier(_entityMovementVerifier);
        encounterVerifier = IVerifier(_encounterVerifier);
        decryptionKeyCommitment = _decryptionKeyCommitment;
        _initializeOwner(_owner);
    }

    // -----------------------------------------------------------------------
    // ERC-721 overrides (solady)
    // -----------------------------------------------------------------------

    function name() public pure override returns (string memory) {
        return "Tall Grass";
    }

    function symbol() public pure override returns (string memory) {
        return "GRASS";
    }

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        if (_ownerOf(tokenId) == address(0)) revert TokenDoesNotExist();
        return ITallGrassMetadata(metadataContract).tokenURI(tokenId);
    }

    function contractURI() public view returns (string memory) {
        return ITallGrassMetadata(metadataContract).contractURI();
    }

    function supportsInterface(bytes4 interfaceId) public view override returns (bool) {
        // ERC-4906: 0x49064906
        // ERC-7572: 0xe8a3d485
        return interfaceId == bytes4(0x49064906) || interfaceId == bytes4(0xe8a3d485)
            || super.supportsInterface(interfaceId);
    }

    // -----------------------------------------------------------------------
    // Admin
    // -----------------------------------------------------------------------

    function setMetadataContract(address _metadataContract) external onlyOwner {
        metadataContract = _metadataContract;
        emit BatchMetadataUpdate(0, type(uint256).max);
        emit ContractURIUpdated();
    }

    function sEP(uint256 eId, address p) external onlyOwner {
        eP[eId] = p;
    }

    function setMintPrice(uint256 _mintPrice) external onlyOwner {
        emit MintPriceUpdated(mintPrice, _mintPrice);
        mintPrice = _mintPrice;
    }

    // -----------------------------------------------------------------------
    // Metadata event emission (ERC-4906 / ERC-7572)
    // -----------------------------------------------------------------------

    modifier onlyEditorOrMetadataContract() {
        if (msg.sender != metadataContract) _checkOwnerOrRoles(EDITOR);
        _;
    }

    function emitMetadataUpdate(uint256 tokenId) external onlyEditorOrMetadataContract {
        emit MetadataUpdate(tokenId);
    }

    function emitBatchMetadataUpdate(uint256 fromTokenId, uint256 toTokenId) external onlyEditorOrMetadataContract {
        emit BatchMetadataUpdate(fromTokenId, toTokenId);
    }

    function emitContractURIUpdated() external onlyEditorOrMetadataContract {
        emit ContractURIUpdated();
    }

    // -----------------------------------------------------------------------
    // Registration
    // -----------------------------------------------------------------------

    /// @notice Register as a participant with an oracle-signed position commitment.
    /// @param initialPositionCommitment Poseidon(x, y, salt) computed client-side.
    /// @param oracleSignature Oracle signature over (participant, commitment).
    function register(bytes32 initialPositionCommitment, bytes memory oracleSignature) external {
        if (isParticipant[msg.sender]) revert AlreadyRegistered();

        bytes32 digest = keccak256(abi.encodePacked(msg.sender, initialPositionCommitment));
        _verifyOracle(digest, oracleSignature);

        isParticipant[msg.sender] = true;
        positionCommitments[msg.sender] = initialPositionCommitment;

        emit Registered(msg.sender, initialPositionCommitment);
    }

    // -----------------------------------------------------------------------
    // Deposits
    // -----------------------------------------------------------------------

    /// @notice Deposit ETH for gas relay. Additive, idempotent.
    function deposit() external payable {
        if (!isParticipant[msg.sender]) revert NotRegistered();
        if (msg.value == 0) revert InsufficientDeposit();
        depositBalance[msg.sender] += msg.value;
        totalDeposits += msg.value;
        emit Deposited(msg.sender, msg.value, depositBalance[msg.sender]);
    }

    /// @notice Withdraw deposit balance.
    function withdrawDeposit(uint256 amount) external {
        if (amount > depositBalance[msg.sender]) revert InsufficientDeposit();
        depositBalance[msg.sender] -= amount;
        totalDeposits -= amount;
        emit DepositWithdrawn(msg.sender, amount);
        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert WithdrawFailed();
    }

    // -----------------------------------------------------------------------
    // Participant Movement
    // -----------------------------------------------------------------------

    /// @notice Submit a ZK proof of valid movement.
    /// @param proof The serialized UltraHonk proof.
    /// @param newPositionCommitment The new Poseidon(x, y, salt) after moving.
    function move(bytes calldata proof, bytes32 newPositionCommitment) external {
        if (!isParticipant[msg.sender]) revert NotRegistered();

        // Public inputs: old_commitment, new_commitment, grid_width, grid_height
        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = positionCommitments[msg.sender];
        publicInputs[1] = newPositionCommitment;
        publicInputs[2] = bytes32(gridWidth);
        publicInputs[3] = bytes32(gridHeight);

        if (!movementVerifier.verify(proof, publicInputs)) revert InvalidProof();

        positionCommitments[msg.sender] = newPositionCommitment;
        moveCounter++;
        participantMoveCount[msg.sender]++;

        emit Moved(msg.sender, newPositionCommitment, moveCounter);
    }

    /// @notice Oracle relays a browser-generated movement proof, reimbursed from deposit.
    function relayMove(
        address participant,
        bytes calldata proof,
        bytes32 newPositionCommitment
    ) external onlyRoles(Roles.ORACLE) {
        if (!isParticipant[participant]) revert NotRegistered();
        if (depositBalance[participant] == 0) revert InsufficientDeposit();

        uint256 gasStart = gasleft();

        bytes32[] memory publicInputs = new bytes32[](4);
        publicInputs[0] = positionCommitments[participant];
        publicInputs[1] = newPositionCommitment;
        publicInputs[2] = bytes32(gridWidth);
        publicInputs[3] = bytes32(gridHeight);
        if (!movementVerifier.verify(proof, publicInputs)) revert InvalidProof();

        positionCommitments[participant] = newPositionCommitment;
        moveCounter++;
        participantMoveCount[participant]++;
        emit Moved(participant, newPositionCommitment, moveCounter);

        uint256 gasUsed = gasStart - gasleft() + GAS_OVERHEAD;
        uint256 gasCost = gasUsed * tx.gasprice;
        if (gasCost > depositBalance[participant]) gasCost = depositBalance[participant];
        depositBalance[participant] -= gasCost;
        totalDeposits -= gasCost;
        if (depositBalance[participant] == 0) emit DepositDepleted(participant);

        (bool ok,) = msg.sender.call{value: gasCost}("");
        if (!ok) revert ReimbursementFailed();
    }

    // -----------------------------------------------------------------------
    // Entity Movement (Owner-Controlled, ZK-Proved)
    // -----------------------------------------------------------------------

    /// @notice Move a minted entity with a ZK proof of valid movement.
    /// @param entityId The entity to move (must be owned by msg.sender).
    /// @param proof The serialized UltraHonk proof.
    /// @param newPositionCommitment The new Poseidon(x, y, salt) after moving.
    /// @param directionCommitment Blinded direction commitment.
    function moveEntity(
        uint256 entityId,
        bytes calldata proof,
        bytes32 newPositionCommitment,
        bytes32 directionCommitment
    ) external {
        if (!entityMinted[entityId]) revert EntityNotMinted();
        if (ownerOf(entityId) != msg.sender) revert NotEntityOwner();

        // Public inputs must match circuit pub param order:
        // old_commitment, new_commitment, grid_width, grid_height,
        // direction_commitment, blinding_seed_commitment, entity_move_count
        bytes32[] memory publicInputs = new bytes32[](7);
        publicInputs[0] = entityPositionCommitments[entityId];
        publicInputs[1] = newPositionCommitment;
        publicInputs[2] = bytes32(gridWidth);
        publicInputs[3] = bytes32(gridHeight);
        publicInputs[4] = directionCommitment;
        publicInputs[5] = entityBlindingSeedCommitments[entityId];
        publicInputs[6] = bytes32(entityMoveCount[entityId]);

        if (!entityMovementVerifier.verify(proof, publicInputs)) revert InvalidProof();

        entityPositionCommitments[entityId] = newPositionCommitment;
        entityMoveCount[entityId]++;
        moveCounter++;

        emit EntityMoved(entityId, directionCommitment, moveCounter);
    }

    // -----------------------------------------------------------------------
    // Minting (ZK encounter proof)
    // -----------------------------------------------------------------------

    /// @notice Mint an encountered entity using a ZK encounter proof.
    /// @param entityId The entity to mint.
    /// @param encounterProof ZK proof of co-location with entity.
    /// @param _entityTraitCID IPFS CID of encrypted traits.
    /// @param initialPositionCommitment Poseidon(x, y, salt) for entity's starting position.
    /// @param blindingSeedCommitment hash_1(blinding_seed) for direction blinding.
    /// @param traitMerkleProof Merkle proof of _entityTraitCID against entityTraitMerkleRoot.
    function mint(
        uint256 entityId,
        bytes calldata encounterProof,
        bytes32 _entityTraitCID,
        bytes32 initialPositionCommitment,
        bytes32 blindingSeedCommitment,
        bytes32[] calldata traitMerkleProof
    ) external payable {
        if (entityMinted[entityId]) revert EntityAlreadyMinted();
        if (msg.value != mintPrice) revert IncorrectPayment();

        // Verify encounter proof
        bytes32[] memory publicInputs = new bytes32[](7);
        publicInputs[0] = seedCommitment;
        publicInputs[1] = bytes32(entityId);
        publicInputs[2] = positionCommitments[msg.sender];
        publicInputs[3] = bytes32(gridWidth);
        publicInputs[4] = bytes32(gridHeight);
        publicInputs[5] = initialPositionCommitment;
        publicInputs[6] = blindingSeedCommitment;
        if (!encounterVerifier.verify(encounterProof, publicInputs)) revert InvalidProof();

        // Verify trait CID against trait Merkle root (keccak256 tree)
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(entityId, _entityTraitCID))));
        if (!MerkleProofLib.verifyCalldata(traitMerkleProof, entityTraitMerkleRoot, leaf)) {
            revert InvalidTraitProof();
        }

        entityMinted[entityId] = true;
        entityTraitCID[entityId] = _entityTraitCID;
        entityPositionCommitments[entityId] = initialPositionCommitment;
        entityBlindingSeedCommitments[entityId] = blindingSeedCommitment;
        entityMoveCount[entityId] = 0;
        totalMinted++;

        _mint(msg.sender, entityId);

        emit Minted(msg.sender, entityId, moveCounter, _entityTraitCID);
    }

    // -----------------------------------------------------------------------
    // Withdrawal
    // -----------------------------------------------------------------------

    /// @notice Withdraw accumulated ETH (mint fees). Oracle-only.
    function withdraw() external onlyRoles(Roles.ORACLE) {
        uint256 withdrawable = address(this).balance - totalDeposits;
        (bool ok,) = msg.sender.call{value: withdrawable}("");
        if (!ok) revert WithdrawFailed();
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    function _verifyOracle(bytes32 digest, bytes memory signature) internal view {
        address signer = ECDSA.recover(ECDSA.toEthSignedMessageHash(digest), signature);
        if (!hasAnyRole(signer, Roles.ORACLE)) revert InvalidSignature();
    }
}
