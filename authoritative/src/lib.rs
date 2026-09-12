use std::collections::BTreeMap;
use std::fmt;

pub const PROTOCOL_VERSION: u8 = 1;
pub const TICK_HZ: u16 = 20;
pub const MAX_PLAYERS: usize = 16;
pub const WORLD_LIMIT: i16 = 10_000;
pub const STEP_UNITS: i16 = 64;
pub const INPUT_DATAGRAM_BYTES: usize = 8;
pub const SNAPSHOT_HEADER_BYTES: usize = 19;
pub const SNAPSHOT_PLAYER_BYTES: usize = 12;
pub const WELCOME_BYTES: usize = 18;

const INPUT_KIND: u8 = 1;
const SNAPSHOT_KIND: u8 = 2;
const WELCOME_KIND: u8 = 3;
const FNV_OFFSET_BASIS: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

pub type PlayerId = u32;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct InputCommand {
    pub sequence: u32,
    pub horizontal: i8,
    pub vertical: i8,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SnapshotPlayer {
    pub player_id: PlayerId,
    pub x: i16,
    pub y: i16,
    pub last_applied_sequence: u32,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Snapshot {
    pub tick: u64,
    pub state_hash: u64,
    pub players: Vec<SnapshotPlayer>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Welcome {
    pub player_id: PlayerId,
    pub tick_hz: u16,
    pub max_players: u8,
    pub current_tick: u64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SubmitOutcome {
    Accepted,
    IgnoredStale,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProtocolError {
    IncorrectLength { expected: usize, actual: usize },
    UnsupportedVersion(u8),
    UnexpectedKind(u8),
    InvalidSequence,
    InvalidAxis { horizontal: i8, vertical: i8 },
    InvalidPlayerCount(usize),
    InvalidStateHash { expected: u64, actual: u64 },
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::IncorrectLength { expected, actual } => {
                write!(formatter, "expected {expected} bytes, received {actual}")
            }
            Self::UnsupportedVersion(version) => {
                write!(
                    formatter,
                    "unsupported authoritative protocol version {version}"
                )
            }
            Self::UnexpectedKind(kind) => {
                write!(formatter, "unexpected authoritative frame kind {kind}")
            }
            Self::InvalidSequence => write!(formatter, "input sequence must be non-zero"),
            Self::InvalidAxis {
                horizontal,
                vertical,
            } => write!(
                formatter,
                "input axes must each be between -1 and 1, got ({horizontal}, {vertical})"
            ),
            Self::InvalidPlayerCount(count) => {
                write!(
                    formatter,
                    "authoritative snapshot contains invalid player count {count}"
                )
            }
            Self::InvalidStateHash { expected, actual } => write!(
                formatter,
                "authoritative snapshot hash mismatch: expected {expected:#018x}, got {actual:#018x}"
            ),
        }
    }
}

impl std::error::Error for ProtocolError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorldError {
    InvalidPlayerId,
    DuplicatePlayer(PlayerId),
    PlayerCapacity,
    UnknownPlayer(PlayerId),
    InvalidInput(ProtocolError),
    TickExhausted,
}

impl fmt::Display for WorldError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::InvalidPlayerId => write!(formatter, "player id zero is reserved"),
            Self::DuplicatePlayer(player_id) => {
                write!(formatter, "player {player_id} already exists")
            }
            Self::PlayerCapacity => {
                write!(formatter, "authoritative world has reached player capacity")
            }
            Self::UnknownPlayer(player_id) => {
                write!(formatter, "unknown authoritative player {player_id}")
            }
            Self::InvalidInput(error) => write!(formatter, "invalid authoritative input: {error}"),
            Self::TickExhausted => write!(formatter, "authoritative tick counter is exhausted"),
        }
    }
}

impl std::error::Error for WorldError {}

impl From<ProtocolError> for WorldError {
    fn from(error: ProtocolError) -> Self {
        Self::InvalidInput(error)
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct PlayerRecord {
    x: i16,
    y: i16,
    horizontal: i8,
    vertical: i8,
    last_received_sequence: u32,
    last_applied_sequence: u32,
}

#[derive(Clone, Debug, Default)]
pub struct AuthoritativeWorld {
    tick: u64,
    players: BTreeMap<PlayerId, PlayerRecord>,
}

impl AuthoritativeWorld {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn tick(&self) -> u64 {
        self.tick
    }

    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    pub fn contains_player(&self, player_id: PlayerId) -> bool {
        self.players.contains_key(&player_id)
    }

    pub fn add_player(&mut self, player_id: PlayerId) -> Result<SnapshotPlayer, WorldError> {
        if player_id == 0 {
            return Err(WorldError::InvalidPlayerId);
        }
        if self.players.contains_key(&player_id) {
            return Err(WorldError::DuplicatePlayer(player_id));
        }
        if self.players.len() >= MAX_PLAYERS {
            return Err(WorldError::PlayerCapacity);
        }

        let (x, y) = spawn_position(player_id);
        self.players.insert(
            player_id,
            PlayerRecord {
                x,
                y,
                horizontal: 0,
                vertical: 0,
                last_received_sequence: 0,
                last_applied_sequence: 0,
            },
        );
        Ok(SnapshotPlayer {
            player_id,
            x,
            y,
            last_applied_sequence: 0,
        })
    }

    pub fn remove_player(&mut self, player_id: PlayerId) -> bool {
        self.players.remove(&player_id).is_some()
    }

    pub fn submit_input(
        &mut self,
        player_id: PlayerId,
        input: InputCommand,
    ) -> Result<SubmitOutcome, WorldError> {
        validate_input(input)?;
        let player = self
            .players
            .get_mut(&player_id)
            .ok_or(WorldError::UnknownPlayer(player_id))?;
        if input.sequence <= player.last_received_sequence {
            return Ok(SubmitOutcome::IgnoredStale);
        }

        player.horizontal = input.horizontal;
        player.vertical = input.vertical;
        player.last_received_sequence = input.sequence;
        Ok(SubmitOutcome::Accepted)
    }

    pub fn advance_tick(&mut self) -> Result<Snapshot, WorldError> {
        self.tick = self.tick.checked_add(1).ok_or(WorldError::TickExhausted)?;
        for player in self.players.values_mut() {
            let next_x = player.x as i32 + i32::from(player.horizontal) * i32::from(STEP_UNITS);
            let next_y = player.y as i32 + i32::from(player.vertical) * i32::from(STEP_UNITS);
            player.x = next_x.clamp(i32::from(-WORLD_LIMIT), i32::from(WORLD_LIMIT)) as i16;
            player.y = next_y.clamp(i32::from(-WORLD_LIMIT), i32::from(WORLD_LIMIT)) as i16;
            player.last_applied_sequence = player.last_received_sequence;
        }
        Ok(self.snapshot())
    }

    pub fn snapshot(&self) -> Snapshot {
        let players = self
            .players
            .iter()
            .map(|(&player_id, player)| SnapshotPlayer {
                player_id,
                x: player.x,
                y: player.y,
                last_applied_sequence: player.last_applied_sequence,
            })
            .collect::<Vec<_>>();
        let state_hash = snapshot_hash(self.tick, &players);
        Snapshot {
            tick: self.tick,
            state_hash,
            players,
        }
    }
}

pub fn encode_input_datagram(
    input: InputCommand,
) -> Result<[u8; INPUT_DATAGRAM_BYTES], ProtocolError> {
    validate_input(input)?;
    let mut bytes = [0_u8; INPUT_DATAGRAM_BYTES];
    bytes[0] = PROTOCOL_VERSION;
    bytes[1] = INPUT_KIND;
    bytes[2..6].copy_from_slice(&input.sequence.to_be_bytes());
    bytes[6] = input.horizontal as u8;
    bytes[7] = input.vertical as u8;
    Ok(bytes)
}

pub fn decode_input_datagram(bytes: &[u8]) -> Result<InputCommand, ProtocolError> {
    require_length(bytes, INPUT_DATAGRAM_BYTES)?;
    require_header(bytes, INPUT_KIND)?;
    let input = InputCommand {
        sequence: u32::from_be_bytes(
            bytes[2..6]
                .try_into()
                .expect("checked input datagram length"),
        ),
        horizontal: bytes[6] as i8,
        vertical: bytes[7] as i8,
    };
    validate_input(input)?;
    Ok(input)
}

pub fn encode_snapshot_datagram(snapshot: &Snapshot) -> Result<Vec<u8>, ProtocolError> {
    if snapshot.players.len() > MAX_PLAYERS {
        return Err(ProtocolError::InvalidPlayerCount(snapshot.players.len()));
    }
    let expected_hash = snapshot_hash(snapshot.tick, &snapshot.players);
    if snapshot.state_hash != expected_hash {
        return Err(ProtocolError::InvalidStateHash {
            expected: expected_hash,
            actual: snapshot.state_hash,
        });
    }

    let mut bytes =
        Vec::with_capacity(SNAPSHOT_HEADER_BYTES + snapshot.players.len() * SNAPSHOT_PLAYER_BYTES);
    bytes.push(PROTOCOL_VERSION);
    bytes.push(SNAPSHOT_KIND);
    bytes.extend_from_slice(&snapshot.tick.to_be_bytes());
    bytes.extend_from_slice(&snapshot.state_hash.to_be_bytes());
    bytes.push(snapshot.players.len() as u8);
    for player in &snapshot.players {
        bytes.extend_from_slice(&player.player_id.to_be_bytes());
        bytes.extend_from_slice(&player.x.to_be_bytes());
        bytes.extend_from_slice(&player.y.to_be_bytes());
        bytes.extend_from_slice(&player.last_applied_sequence.to_be_bytes());
    }
    Ok(bytes)
}

pub fn decode_snapshot_datagram(bytes: &[u8]) -> Result<Snapshot, ProtocolError> {
    if bytes.len() < SNAPSHOT_HEADER_BYTES {
        return Err(ProtocolError::IncorrectLength {
            expected: SNAPSHOT_HEADER_BYTES,
            actual: bytes.len(),
        });
    }
    require_header(bytes, SNAPSHOT_KIND)?;
    let player_count = usize::from(bytes[18]);
    if player_count > MAX_PLAYERS {
        return Err(ProtocolError::InvalidPlayerCount(player_count));
    }
    let expected_length = SNAPSHOT_HEADER_BYTES + player_count * SNAPSHOT_PLAYER_BYTES;
    require_length(bytes, expected_length)?;

    let tick = u64::from_be_bytes(
        bytes[2..10]
            .try_into()
            .expect("checked snapshot header length"),
    );
    let state_hash = u64::from_be_bytes(
        bytes[10..18]
            .try_into()
            .expect("checked snapshot header length"),
    );
    let mut players = Vec::with_capacity(player_count);
    for index in 0..player_count {
        let offset = SNAPSHOT_HEADER_BYTES + index * SNAPSHOT_PLAYER_BYTES;
        players.push(SnapshotPlayer {
            player_id: u32::from_be_bytes(
                bytes[offset..offset + 4]
                    .try_into()
                    .expect("checked snapshot player length"),
            ),
            x: i16::from_be_bytes(
                bytes[offset + 4..offset + 6]
                    .try_into()
                    .expect("checked snapshot player length"),
            ),
            y: i16::from_be_bytes(
                bytes[offset + 6..offset + 8]
                    .try_into()
                    .expect("checked snapshot player length"),
            ),
            last_applied_sequence: u32::from_be_bytes(
                bytes[offset + 8..offset + 12]
                    .try_into()
                    .expect("checked snapshot player length"),
            ),
        });
    }

    let expected_hash = snapshot_hash(tick, &players);
    if state_hash != expected_hash {
        return Err(ProtocolError::InvalidStateHash {
            expected: expected_hash,
            actual: state_hash,
        });
    }
    Ok(Snapshot {
        tick,
        state_hash,
        players,
    })
}

pub fn encode_welcome(welcome: Welcome) -> [u8; WELCOME_BYTES] {
    let mut bytes = [0_u8; WELCOME_BYTES];
    bytes[0] = PROTOCOL_VERSION;
    bytes[1] = WELCOME_KIND;
    bytes[2..6].copy_from_slice(&welcome.player_id.to_be_bytes());
    bytes[6..8].copy_from_slice(&welcome.tick_hz.to_be_bytes());
    bytes[8] = welcome.max_players;
    bytes[9] = 0;
    bytes[10..18].copy_from_slice(&welcome.current_tick.to_be_bytes());
    bytes
}

pub fn decode_welcome(bytes: &[u8]) -> Result<Welcome, ProtocolError> {
    require_length(bytes, WELCOME_BYTES)?;
    require_header(bytes, WELCOME_KIND)?;
    Ok(Welcome {
        player_id: u32::from_be_bytes(bytes[2..6].try_into().expect("checked welcome length")),
        tick_hz: u16::from_be_bytes(bytes[6..8].try_into().expect("checked welcome length")),
        max_players: bytes[8],
        current_tick: u64::from_be_bytes(bytes[10..18].try_into().expect("checked welcome length")),
    })
}

pub fn snapshot_hash(tick: u64, players: &[SnapshotPlayer]) -> u64 {
    let mut hash = FNV_OFFSET_BASIS;
    hash = fnv_update(hash, &tick.to_be_bytes());
    hash = fnv_update(hash, &[players.len() as u8]);
    for player in players {
        hash = fnv_update(hash, &player.player_id.to_be_bytes());
        hash = fnv_update(hash, &player.x.to_be_bytes());
        hash = fnv_update(hash, &player.y.to_be_bytes());
        hash = fnv_update(hash, &player.last_applied_sequence.to_be_bytes());
    }
    hash
}

fn validate_input(input: InputCommand) -> Result<(), ProtocolError> {
    if input.sequence == 0 {
        return Err(ProtocolError::InvalidSequence);
    }
    if !(-1..=1).contains(&input.horizontal) || !(-1..=1).contains(&input.vertical) {
        return Err(ProtocolError::InvalidAxis {
            horizontal: input.horizontal,
            vertical: input.vertical,
        });
    }
    Ok(())
}

fn require_header(bytes: &[u8], expected_kind: u8) -> Result<(), ProtocolError> {
    if bytes[0] != PROTOCOL_VERSION {
        return Err(ProtocolError::UnsupportedVersion(bytes[0]));
    }
    if bytes[1] != expected_kind {
        return Err(ProtocolError::UnexpectedKind(bytes[1]));
    }
    Ok(())
}

fn require_length(bytes: &[u8], expected: usize) -> Result<(), ProtocolError> {
    if bytes.len() != expected {
        return Err(ProtocolError::IncorrectLength {
            expected,
            actual: bytes.len(),
        });
    }
    Ok(())
}

fn fnv_update(mut hash: u64, bytes: &[u8]) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn spawn_position(player_id: PlayerId) -> (i16, i16) {
    let ordinal = (player_id - 1) % MAX_PLAYERS as u32;
    let column = (ordinal % 4) as i16;
    let row = (ordinal / 4) as i16;
    (column * 512 - 768, row * 512 - 768)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(sequence: u32, horizontal: i8, vertical: i8) -> InputCommand {
        InputCommand {
            sequence,
            horizontal,
            vertical,
        }
    }

    #[test]
    fn input_datagram_round_trips_without_a_player_identity_field() {
        let command = input(7, -1, 1);
        let encoded = encode_input_datagram(command).unwrap();
        assert_eq!(encoded.len(), INPUT_DATAGRAM_BYTES);
        assert_eq!(decode_input_datagram(&encoded).unwrap(), command);
    }

    #[test]
    fn malformed_input_datagrams_fail_closed() {
        assert!(matches!(
            decode_input_datagram(&[PROTOCOL_VERSION, INPUT_KIND]),
            Err(ProtocolError::IncorrectLength { .. })
        ));
        assert!(matches!(
            encode_input_datagram(input(0, 0, 0)),
            Err(ProtocolError::InvalidSequence)
        ));
        assert!(matches!(
            encode_input_datagram(input(1, 2, 0)),
            Err(ProtocolError::InvalidAxis { .. })
        ));
    }

    #[test]
    fn accepted_input_changes_intent_but_not_authoritative_position_until_a_tick() {
        let mut world = AuthoritativeWorld::new();
        let spawned = world.add_player(1).unwrap();
        assert_eq!(
            world.submit_input(1, input(1, 1, 0)).unwrap(),
            SubmitOutcome::Accepted
        );
        assert_eq!(world.snapshot().players[0], spawned);

        let after_tick = world.advance_tick().unwrap();
        assert_eq!(after_tick.tick, 1);
        assert_eq!(after_tick.players[0].x, spawned.x + STEP_UNITS);
        assert_eq!(after_tick.players[0].last_applied_sequence, 1);
    }

    #[test]
    fn duplicate_and_stale_inputs_are_idempotently_ignored() {
        let mut world = AuthoritativeWorld::new();
        world.add_player(1).unwrap();
        assert_eq!(
            world.submit_input(1, input(2, 1, 0)).unwrap(),
            SubmitOutcome::Accepted
        );
        assert_eq!(
            world.submit_input(1, input(2, -1, 0)).unwrap(),
            SubmitOutcome::IgnoredStale
        );
        assert_eq!(
            world.submit_input(1, input(1, -1, 0)).unwrap(),
            SubmitOutcome::IgnoredStale
        );
        let snapshot = world.advance_tick().unwrap();
        assert_eq!(snapshot.players[0].last_applied_sequence, 2);
        assert_eq!(snapshot.players[0].x, -768 + STEP_UNITS);
    }

    #[test]
    fn clients_cannot_submit_state_for_another_or_unknown_player() {
        let mut world = AuthoritativeWorld::new();
        world.add_player(1).unwrap();
        assert_eq!(
            world.submit_input(2, input(1, 1, 0)),
            Err(WorldError::UnknownPlayer(2))
        );
        assert_eq!(world.snapshot().players.len(), 1);
    }

    #[test]
    fn replaying_the_same_authoritative_inputs_produces_the_same_state_hashes() {
        let mut left = AuthoritativeWorld::new();
        let mut right = AuthoritativeWorld::new();
        for player_id in [3, 1, 2] {
            left.add_player(player_id).unwrap();
            right.add_player(player_id).unwrap();
        }

        for sequence in 1_u32..=40 {
            let player_id = sequence % 3 + 1;
            let command = if sequence.is_multiple_of(2) {
                input(sequence, 1, 0)
            } else {
                input(sequence, 0, -1)
            };
            left.submit_input(player_id, command).unwrap();
            right.submit_input(player_id, command).unwrap();
            let left_snapshot = left.advance_tick().unwrap();
            let right_snapshot = right.advance_tick().unwrap();
            assert_eq!(left_snapshot, right_snapshot);
        }
    }

    #[test]
    fn player_capacity_is_bounded_at_sixteen() {
        let mut world = AuthoritativeWorld::new();
        for player_id in 1..=MAX_PLAYERS as u32 {
            world.add_player(player_id).unwrap();
        }
        assert_eq!(world.player_count(), MAX_PLAYERS);
        assert_eq!(
            world.add_player(MAX_PLAYERS as u32 + 1),
            Err(WorldError::PlayerCapacity)
        );
    }

    #[test]
    fn movement_is_clamped_to_the_authoritative_world_boundary() {
        let mut world = AuthoritativeWorld::new();
        world.add_player(1).unwrap();
        world.submit_input(1, input(1, -1, -1)).unwrap();
        for _ in 0..500 {
            world.advance_tick().unwrap();
        }
        let player = world.snapshot().players[0];
        assert_eq!(player.x, -WORLD_LIMIT);
        assert_eq!(player.y, -WORLD_LIMIT);
    }

    #[test]
    fn compact_snapshot_round_trips_and_detects_tampering() {
        let mut world = AuthoritativeWorld::new();
        for player_id in 1..=MAX_PLAYERS as u32 {
            world.add_player(player_id).unwrap();
        }
        let snapshot = world.advance_tick().unwrap();
        let encoded = encode_snapshot_datagram(&snapshot).unwrap();
        assert_eq!(
            encoded.len(),
            SNAPSHOT_HEADER_BYTES + MAX_PLAYERS * SNAPSHOT_PLAYER_BYTES
        );
        assert!(encoded.len() < 256);
        assert_eq!(decode_snapshot_datagram(&encoded).unwrap(), snapshot);

        let mut tampered = encoded;
        tampered[SNAPSHOT_HEADER_BYTES + 4] ^= 1;
        assert!(matches!(
            decode_snapshot_datagram(&tampered),
            Err(ProtocolError::InvalidStateHash { .. })
        ));
    }

    #[test]
    fn reliable_welcome_frame_round_trips_server_assigned_identity() {
        let welcome = Welcome {
            player_id: 17,
            tick_hz: TICK_HZ,
            max_players: MAX_PLAYERS as u8,
            current_tick: 99,
        };
        let encoded = encode_welcome(welcome);
        assert_eq!(encoded.len(), WELCOME_BYTES);
        assert_eq!(decode_welcome(&encoded).unwrap(), welcome);
    }

    #[test]
    fn removal_is_server_owned_and_idempotent() {
        let mut world = AuthoritativeWorld::new();
        world.add_player(1).unwrap();
        assert!(world.remove_player(1));
        assert!(!world.remove_player(1));
        assert!(!world.contains_player(1));
    }
}
