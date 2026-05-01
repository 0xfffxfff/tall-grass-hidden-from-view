# Digital Exhibit Submission

![Tall Grass (Hidden From View)](/exhibit.jpg)

By 0xfff. Submitted to the Pixel Prize, JUST Open Source Stiftung, 2026.

---

## 1. The work

| | |
|---|---|
| **Title** | Tall Grass (Hidden From View) |
| **Artist** | 0xfff |
| **Year** | 2026 |
| **Network (testnet)** | Sepolia, contract address: [`0x72F2b87dB9cF46d19618dAc75EBa656cE747045c`](https://sepolia.etherscan.io/address/0x72F2b87dB9cF46d19618dAc75EBa656cE747045c) |
| **Frontend (live)** | <https://tallgrass.0xfff.love/> |
| **Source repository** | <https://github.com/0xfffxfff/tall-grass-hidden-from-view> (GPL-3.0) |

### 1.1 Instructions for the jury

1. Open `https://tallgrass.0xfff.love/` in a desktop browser. A wallet (MetaMask, Rabby, or any wagmi-supported connector) configured for Sepolia is required. Sepolia ETH is needed for gas.
2. Click *Connect* and sign the wallet message. The oracle will register your address, return a starting position, and sign the initial position commitment. Submit the registration transaction.
3. Use the four directional buttons (N / S / E / W) to move. Each move generates a zero-knowledge proof in your browser (~1-3 seconds on a modern device); watch the proving animation. Submit the move transaction.
4. After a move, the oracle reports any encounter on your new cell. The terrain itself is never revealed cell-by-cell — there is no map; an encounter is the only signal that you have stepped onto a tall grass cell occupied by an entity. The landscape only emerges through the monolith's progressive reveal.
5. If you encounter a shrouded entity on a tall grass cell, you may attempt to mint it. The mint transaction includes the ZK encounter proof and the mint fee.
6. Use the *Compare* tool to homomorphically compare any two minted entities on any trait. The comparison runs in your browser via WASM-compiled TFHE; the oracle decrypts only the boolean output and returns a ZK proof of correct decryption that the browser verifies locally.
7. Optional: deposit ETH to let the oracle relay your moves (you still generate the proof locally — the oracle just pays gas and reimburses from your deposit).

*Available on request:* a live remote walkthrough with the artist (≈20 min, screenshare) for jury members who would prefer a guided tour to interacting solo. Contact: 0xfff@protonmail.com.

---

## 2. Artist statement

![Tall Grass (Hidden From View)](/exhibit2.jpg)

Privacy is usually defended. In *Tall Grass (Hidden From View)* I'm looking at it as a generative material.

The piece is a hidden landscape on Ethereum. Visitors enter and walk through it. Their positions are private — to the contract, to the artist, and to each other. They can encounter shrouded entities and collect them. Each entity has fully homomorphically encrypted traits. Anyone may compare two entities; the chain publishes only the direction of the result. The underlying values are never revealed. Every move is verified by a zero-knowledge proof: the contract verifies the move was valid without learning where it happened.

In cryptography, privacy tends to be solitary. My key, my data, my asset. *Tall Grass* makes it collective and spatial. Multiple participants share the same hidden world. They are present together, mutually invisible. Their movements affect a shared state. They can encounter entities others have already touched. Privacy here is not a property of a person or an object. It is a property of the space they share. This is what interests me most about the piece. Privacy that isolates an individual is well understood. Privacy that holds a public together is not. This is closer to what Édouard Glissant called the right to opacity: not refusal of relation but its condition.

The Monolith is the work's body in the room: two screens, mounted back to back, reading the contract in real time. Slow forms drift at right angles through a dark field — encounters resolving, comparisons computing, participants moving through. Visitors navigate but cannot see. Entities are compared but cannot be read. The Monolith moves but cannot be deciphered.

The work is honest about what is not yet possible. An oracle holds the landscape's seed; today I choose not to look. The next version makes the choice unnecessary: a hardware enclave I can't read, and cryptographic terrain reveals that remove the oracle's knowledge entirely. The proposed sculpture — a frosted-glass body with mechanical parts behind the haze — is also deferred to that delivery; for the grantee exhibition the Monolith is realised as a screen-based study. *[Tall Grass](https://tallgrass.0xfff.love/)* is a shift from earlier work I made under this pseudonym — from smart contracts as durable objects whose transparency was the material, to a hidden program with public proof of private action.

Privacy is defended as a human right by listing what we are entitled to hide. *Tall Grass* makes the opposite argument. When privacy is the medium, it produces forms that visibility cannot.

I believe it is high time to engage with these techniques as artists, while they are still strange, unwieldy, and shapeable — before they have been decided for us.

— 0xfff

## 3. Exhibition-ready assets

### 3.1 Title

**Tall Grass (Hidden From View)**

### 3.2 Short description (pamphlet, ~120 words)

An interactive piece for visitors to navigate an encrypted digital landscape using zero-knowledge proofs. Move through the hidden terrain, encounter mysterious entities, and collect them, all while your position stays unknown to everyone else.

At the center of the work stands the Monolith: a glowing frosted-glass sculpture. Though its inner workings are obscured, it responds in real time to every action taken in the encrypted landscape: a physical body translating invisible computation into visible motion.

Tall Grass treats privacy not as a barrier, but as a creative medium. Visitors interact without being observed, hold property whose contents cannot be read, and share a space they cannot see each other inside. What becomes possible inside those conditions is the work's question.

### 3.3 Long description (~300 words)

*Tall Grass (Hidden From View)* is a programmable cryptography artwork in three components: an encrypted landscape, a set of shrouded entities that inhabit it, and a Monolith that renders the hidden state as light.

The landscape is a toroidal grid whose terrain — tall grass and clear ground, in roughly equal measure — is committed on-chain at deployment as a Poseidon hash of its seed, then never revealed publicly. Participants connect a wallet, receive a starting position from a sealed oracle, and move one cell at a time. Every move is a zero-knowledge proof generated in the participant's browser and verified on-chain: the contract sees that a move was valid without ever learning where it happened. Positions live as Poseidon commitments. Direction is private.

When a participant lands on a tall grass cell occupied by an entity, an encounter occurs. The participant can mint the entity by submitting a second zero-knowledge proof attesting co-location with a seed-derived position. Each entity carries a set of fully homomorphically encrypted traits — encrypted before deployment, opaque forever. Anyone may homomorphically compare any two minted entities on any trait; the oracle decrypts only the encrypted boolean result and returns a zero-knowledge proof that the decryption was performed correctly under a key whose commitment is fixed on-chain.

The Monolith is the physical surface of the work in the room: two displays mounted back to back, reading the contract in real time. The visual is a generative field — axis-aligned slabs and sweeps drifting through dark space, each form a kinetic signature derived from a ciphertext, a comparison pair, or a move. Forms surface, peak, and resolve back into the field; the Monolith is steady, responsive churn, never going fully dark. The work is visible but illegible: present but unreadable. For the May 1 grantee exhibition the Monolith is realised as a screen-based study; the proposed frosted-glass body with mechanical parts behind the haze is grand-prize scope.

Everything — Noir circuits, Solidity contracts, TFHE C compiled to WebAssembly, the frontend, the oracle — is [open source](https://github.com/0xfffxfff/tall-grass-hidden-from-view) under GPL-3.0.

### 3.4 Credits

- Artist: 0xfff
- Funded by The Pixel Prize / JUST Open Source Stiftung
- License: GPL-3.0 (whole stack)
- Network: Ethereum Mainnet

---

*Updated: May 1, 2026, 14:43 CEST.*
