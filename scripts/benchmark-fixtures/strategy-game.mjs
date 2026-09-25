const BOARD_WIDTH = 20;
const BOARD_HEIGHT = 24;
const LAYER_COUNT = 3;
const TILES_PER_LAYER = BOARD_WIDTH * BOARD_HEIGHT;
const MATERIALS = ['stone', 'dirt', 'wood', 'water', 'grass'];
const GLYPHS = ['·', '░', '▒', '≈', '♣'];

export const strategyGameScale = Object.freeze({
  effects: 96,
  height: BOARD_HEIGHT,
  inventoryItems: 24,
  layers: LAYER_COUNT,
  mechanisms: 30,
  tiles: TILES_PER_LAYER * LAYER_COUNT,
  units: 48,
  width: BOARD_WIDTH,
});

function makePosition(index, layer) {
  return [index % BOARD_WIDTH, Math.floor(index / BOARD_WIDTH), layer];
}

function createGameState() {
  const layers = Array.from({ length: LAYER_COUNT }, (_, layerIndex) => ({
    id: `layer-${layerIndex}`,
    tiles: Array.from({ length: TILES_PER_LAYER }, (_, tileIndex) => {
      const [x, y] = makePosition(tileIndex, layerIndex);
      const materialIndex = (x * 3 + y * 5 + layerIndex) % MATERIALS.length;
      return {
        glyph: GLYPHS[materialIndex],
        id: `tile-${layerIndex}-${x}-${y}`,
        material: MATERIALS[materialIndex],
        position: [x, y, layerIndex],
        shade: (x * 13 + y * 7 + layerIndex) % 6,
        variant: (x * 11 + y * 17 + layerIndex) % 4,
      };
    }),
  }));
  const units = Array.from({ length: strategyGameScale.units }, (_, index) => {
    const layer = index % LAYER_COUNT;
    const [x, y] = makePosition((index * 29) % TILES_PER_LAYER, layer);
    return {
      className: ['warrior', 'mage', 'rogue', 'cleric'][index % 4],
      health: 40 + ((index * 7) % 61),
      id: `unit-${index}`,
      name: `Unit ${index + 1}`,
      position: [x, y, layer],
      spent: index % 5 === 0,
      team: index % 3 === 0 ? 'enemy' : 'player',
    };
  });
  const mechanisms = Array.from(
    { length: strategyGameScale.mechanisms },
    (_, index) => {
      const layer = index % LAYER_COUNT;
      const [x, y] = makePosition((index * 41 + 7) % TILES_PER_LAYER, layer);
      return {
        id: `mechanism-${index}`,
        position: [x, y, layer],
        state: index % 4 === 0 ? 'active' : 'idle',
        type: ['door', 'light', 'switch', 'barrier', 'bloom'][index % 5],
      };
    },
  );
  const effects = Array.from(
    { length: strategyGameScale.effects },
    (_, index) => {
      const layer = index % LAYER_COUNT;
      const [x, y] = makePosition((index * 17 + 11) % TILES_PER_LAYER, layer);
      return {
        id: `effect-${index}`,
        intensity: (index % 3) + 1,
        position: [x, y, layer],
        type: ['fire', 'fog', 'mycelium', 'rain'][index % 4],
      };
    },
  );
  const placedItems = Array.from({ length: 36 }, (_, index) => {
    const layer = index % LAYER_COUNT;
    const [x, y] = makePosition((index * 31 + 5) % TILES_PER_LAYER, layer);
    return {
      id: `placed-item-${index}`,
      name: `Field item ${index + 1}`,
      position: [x, y, layer],
    };
  });
  const corpses = Array.from({ length: 18 }, (_, index) => {
    const layer = index % LAYER_COUNT;
    const [x, y] = makePosition((index * 37 + 13) % TILES_PER_LAYER, layer);
    return { id: `corpse-${index}`, position: [x, y, layer] };
  });
  const inventory = Array.from(
    { length: strategyGameScale.inventoryItems },
    (_, index) => ({
      id: `inventory-item-${index}`,
      name: `Inventory item ${index + 1}`,
      rating: (index % 5) + 1,
      type: ['weapon', 'armor', 'consumable', 'modifier'][index % 4],
      uses: index % 4,
    }),
  );
  return {
    activeLayer: LAYER_COUNT - 1,
    board: {
      fogOfWar: 'dark',
      height: BOARD_HEIGHT,
      layers,
      name: 'Garrison of the Dead benchmark',
      width: BOARD_WIDTH,
    },
    corpses,
    effects,
    inventory,
    logs: Array.from(
      { length: 12 },
      (_, index) => `Turn ${index + 1}: tactical event resolved`,
    ),
    mechanisms,
    placedItems,
    turn: { count: 17, phase: 'active', player: 'player' },
    units,
  };
}

export function createStrategyGameFixture(React) {
  const h = React.createElement;
  const gameState = createGameState();
  const GameStateContext = React.createContext(null);

  function useGameState() {
    const state = React.useContext(GameStateContext);
    if (state === null) throw new Error('Missing game state provider');
    return state;
  }

  function GameStateProvider({ children }) {
    return h(GameStateContext.Provider, { value: gameState }, children);
  }

  const AsciiMaterialTile = React.memo(function AsciiMaterialTile({ tile }) {
    const [x, y, layer] = tile.position;
    return h('div', {
      'aria-hidden': 'true',
      className: `tile tile-${tile.material}`,
      'data-benchmark-tile': tile.id,
      'data-glyph': tile.glyph,
      'data-shade': tile.shade,
      'data-variant': tile.variant,
      style: {
        gridColumnStart: x + 1,
        gridRowStart: y + 1,
        opacity: layer === gameState.activeLayer ? 1 : 0.65,
      },
    });
  });

  function AsciiMaterialLayer({ layer }) {
    return h(
      'div',
      { className: 'material-layer' },
      layer.tiles.map((tile) => h(AsciiMaterialTile, { key: tile.id, tile })),
    );
  }

  const UnitComponent = React.memo(function UnitComponent({ selected, unit }) {
    const [x, y] = unit.position;
    return h(
      'button',
      {
        'aria-label': `${unit.team} unit ${unit.name}`,
        className: `unit unit-${unit.className}`,
        'data-benchmark-unit': unit.id,
        'data-selected': selected || undefined,
        disabled: unit.spent,
        style: { gridColumnStart: x + 1, gridRowStart: y + 1 },
        type: 'button',
      },
      h(
        'span',
        { className: 'sprite-shell' },
        h('span', { className: 'sprite sprite-body' }),
        h('span', { className: 'sprite sprite-weapon' }),
        h('span', { className: 'sprite sprite-shadow' }),
      ),
      h(
        'span',
        { className: 'health-track' },
        h('span', {
          className: 'health-value',
          style: { width: `${unit.health}%` },
        }),
      ),
      h('span', { className: 'unit-name' }, unit.name),
    );
  });

  function UnitLayer({ layerIndex, selectedUnitId }) {
    const { units } = useGameState();
    const visibleUnits = React.useMemo(
      () => units.filter((unit) => unit.position[2] === layerIndex),
      [layerIndex, units],
    );
    return h(
      'div',
      { className: 'unit-layer' },
      visibleUnits.map((unit) =>
        h(UnitComponent, {
          key: unit.id,
          selected: unit.id === selectedUnitId,
          unit,
        }),
      ),
    );
  }

  const MechanismComponent = React.memo(function MechanismComponent({ item }) {
    const [x, y] = item.position;
    return h(
      'button',
      {
        'aria-label': `${item.type} ${item.state}`,
        className: `mechanism mechanism-${item.type}`,
        'data-benchmark-mechanism': item.id,
        style: { gridColumnStart: x + 1, gridRowStart: y + 1 },
        type: 'button',
      },
      h('span', { 'aria-hidden': 'true', className: 'mechanism-icon' }),
    );
  });

  function MechanismLayer({ layerIndex }) {
    const { mechanisms } = useGameState();
    const visibleMechanisms = React.useMemo(
      () => mechanisms.filter((item) => item.position[2] === layerIndex),
      [layerIndex, mechanisms],
    );
    return h(
      'div',
      { className: 'mechanism-layer' },
      visibleMechanisms.map((item) =>
        h(MechanismComponent, { item, key: item.id }),
      ),
    );
  }

  const EffectOverlay = React.memo(function EffectOverlay({ effect }) {
    const [x, y] = effect.position;
    return h('div', {
      'aria-hidden': 'true',
      className: `effect effect-${effect.type}`,
      'data-benchmark-effect': effect.id,
      'data-intensity': effect.intensity,
      style: { gridColumnStart: x + 1, gridRowStart: y + 1 },
    });
  });

  function EnvironmentalEffectsLayer({ layerIndex }) {
    const { effects } = useGameState();
    const visibleEffects = React.useMemo(
      () => effects.filter((effect) => effect.position[2] === layerIndex),
      [effects, layerIndex],
    );
    return h(
      'div',
      { className: 'environmental-effects-layer' },
      visibleEffects.map((effect) =>
        h(EffectOverlay, { effect, key: effect.id }),
      ),
    );
  }

  function PlacedItemLayer({ layerIndex }) {
    const { placedItems } = useGameState();
    return h(
      'div',
      { className: 'placed-item-layer' },
      placedItems
        .filter((item) => item.position[2] === layerIndex)
        .map((item) =>
          h(
            'button',
            {
              'aria-label': item.name,
              'data-placed-item': item.id,
              key: item.id,
              type: 'button',
            },
            item.name,
          ),
        ),
    );
  }

  function CorpseLayer({ layerIndex }) {
    const { corpses } = useGameState();
    return h(
      'div',
      { className: 'corpse-layer' },
      corpses
        .filter((corpse) => corpse.position[2] === layerIndex)
        .map((corpse) =>
          h('span', {
            'aria-hidden': 'true',
            'data-corpse': corpse.id,
            key: corpse.id,
          }),
        ),
    );
  }

  function FogOfWar({ layer }) {
    return h(
      'div',
      { 'aria-hidden': 'true', className: 'fog-of-war' },
      layer.tiles.map((tile, index) =>
        h('span', {
          className: index % 7 === 0 ? 'fog-dark' : 'fog-light',
          'data-fog-tile': tile.id,
          key: tile.id,
        }),
      ),
    );
  }

  function GameLayer({ layer, layerIndex, selectedUnitId }) {
    const active = layerIndex === gameState.activeLayer;
    return h(
      'section',
      {
        'aria-label': `Board layer ${layerIndex + 1}`,
        className: 'game-layer',
        'data-layer': layerIndex,
        style: {
          gridTemplateColumns: `repeat(${BOARD_WIDTH}, 32px)`,
          gridTemplateRows: `repeat(${BOARD_HEIGHT}, 32px)`,
          opacity: active ? 1 : 0.4,
        },
      },
      h(AsciiMaterialLayer, { layer }),
      h(CorpseLayer, { layerIndex }),
      h(UnitLayer, { layerIndex, selectedUnitId }),
      h(PlacedItemLayer, { layerIndex }),
      h(EnvironmentalEffectsLayer, { layerIndex }),
      h(MechanismLayer, { layerIndex }),
      active ? h(FogOfWar, { layer }) : null,
    );
  }

  function GameGrid({ selectedUnitId }) {
    const { board } = useGameState();
    return h(
      'div',
      {
        className: 'game-grid',
        'data-testid': 'game-content',
        style: {
          height: board.height * 32,
          width: board.width * 32,
        },
      },
      board.layers.map((layer, layerIndex) =>
        h(GameLayer, {
          key: layer.id,
          layer,
          layerIndex,
          selectedUnitId,
        }),
      ),
    );
  }

  function ActionBarSlotButton({ disabled, index, label }) {
    return h(
      'button',
      {
        'aria-label': label,
        className: 'action-bar-slot',
        disabled,
        type: 'button',
      },
      h('kbd', null, String(index + 1)),
      h('span', null, label),
    );
  }

  function MiniMessageLog() {
    const { logs } = useGameState();
    return h(
      'ol',
      { 'aria-label': 'Recent events' },
      logs.map((entry) => h('li', { key: entry }, entry)),
    );
  }

  function ActionBar({ selectedUnitId }) {
    const { inventory, units } = useGameState();
    const unit = units.find(({ id }) => id === selectedUnitId);
    const slots = React.useMemo(() => inventory.slice(0, 8), [inventory]);
    return h(
      'section',
      { 'aria-label': `Actions for ${unit?.name ?? 'no unit'}` },
      h(
        'div',
        { className: 'action-bar-slots' },
        slots.map((item, index) =>
          h(ActionBarSlotButton, {
            disabled: unit?.spent ?? true,
            index,
            key: item.id,
            label: item.name,
          }),
        ),
      ),
      h(MiniMessageLog),
      h('button', { type: 'button' }, 'End turn'),
    );
  }

  function Portraits({ selectedUnitId }) {
    const { units } = useGameState();
    return h(
      'nav',
      { 'aria-label': 'Player units' },
      units
        .filter((unit) => unit.team === 'player')
        .slice(0, 12)
        .map((unit) =>
          h(
            'button',
            {
              'aria-current': unit.id === selectedUnitId || undefined,
              key: unit.id,
              type: 'button',
            },
            unit.name,
          ),
        ),
    );
  }

  function LayerNavigation() {
    const { board } = useGameState();
    return h(
      'nav',
      { 'aria-label': 'Board layers' },
      board.layers.map((layer, index) =>
        h(
          'button',
          {
            'aria-pressed': index === gameState.activeLayer,
            key: layer.id,
            type: 'button',
          },
          `Layer ${index + 1}`,
        ),
      ),
    );
  }

  function TurnIndicator() {
    const { turn } = useGameState();
    return h(
      'output',
      { className: 'turn-indicator' },
      `Turn ${turn.count}: ${turn.player} ${turn.phase}`,
    );
  }

  function SettingsMenu() {
    return h(
      'form',
      { 'aria-label': 'Board settings' },
      ['Fog', 'Lighting', 'Tile costs', 'Team colors'].map((label, index) =>
        h(
          'label',
          { key: label },
          h('input', {
            checked: index !== 2,
            readOnly: true,
            type: 'checkbox',
          }),
          label,
        ),
      ),
    );
  }

  function GameOverlay({ actionBar, bottom, left, top }) {
    return h(
      'aside',
      { className: 'game-overlay' },
      h('div', { className: 'overlay-top' }, top),
      h('div', { className: 'overlay-left' }, left),
      h('div', { className: 'overlay-bottom' }, bottom),
      h('div', { className: 'overlay-action-bar' }, actionBar),
    );
  }

  function EquipmentPanel({ unit }) {
    const slots = [
      'helmet',
      'accessory',
      'main-hand',
      'gloves',
      'off-hand',
      'chest',
      'boots',
      'trinket',
    ];
    return h(
      'section',
      { 'aria-label': `${unit.name} equipment` },
      slots.map((slot) =>
        h(
          'button',
          { 'data-equipment-slot': slot, key: slot, type: 'button' },
          slot,
        ),
      ),
    );
  }

  function InventoryGrid() {
    const { inventory } = useGameState();
    return h(
      'section',
      { 'aria-label': 'Inventory', className: 'inventory-grid' },
      inventory.map((item) =>
        h(
          'button',
          {
            'aria-label': `${item.name}, rating ${item.rating}`,
            'data-inventory-item': item.id,
            key: item.id,
            type: 'button',
          },
          h('span', { className: `item-icon item-${item.type}` }),
          h('span', null, item.name),
          h('small', null, `Uses ${item.uses}`),
        ),
      ),
    );
  }

  function InfoDisplay({ unitId }) {
    const { units } = useGameState();
    const unit = units.find(({ id }) => id === unitId);
    if (!unit) return null;
    return h(
      'dialog',
      { 'aria-label': `${unit.name} details`, open: true },
      h('header', null, h('h2', null, unit.name), h('button', null, 'Close')),
      h(
        'div',
        { role: 'tablist' },
        h('button', { role: 'tab', type: 'button' }, 'Overview'),
        h(
          'button',
          { 'aria-selected': 'true', role: 'tab', type: 'button' },
          'Bag',
        ),
        h('button', { role: 'tab', type: 'button' }, 'Stats'),
      ),
      h(
        'div',
        { role: 'tabpanel' },
        h(EquipmentPanel, { unit }),
        h(InventoryGrid),
      ),
    );
  }

  function Combat() {
    const { units } = useGameState();
    const participants = [units[0], units[1]];
    return h(
      'section',
      { 'aria-label': 'Combat forecast', hidden: true },
      participants.map((unit) =>
        h(
          'article',
          { key: unit.id },
          h('h3', null, unit.name),
          h('dl', null, h('dt', null, 'Health'), h('dd', null, unit.health)),
        ),
      ),
    );
  }

  function TradeView() {
    return h('section', { 'aria-label': 'Trade', hidden: true });
  }

  function GameOverModal() {
    return null;
  }

  function GameBoard({ selectedUnitId }) {
    const { board } = useGameState();
    const [focusedUnitId] = React.useState(selectedUnitId);
    const top = h(
      'div',
      { className: 'top-controls' },
      h(TurnIndicator),
      h(SettingsMenu),
    );
    return h(
      'main',
      {
        'data-benchmark-board': `${board.width}x${board.height}x${board.layers.length}`,
        'data-testid': 'game-board',
      },
      h(
        'div',
        { className: 'game-container' },
        h(GameOverlay, {
          actionBar: h(ActionBar, { selectedUnitId: focusedUnitId }),
          bottom: h(LayerNavigation),
          left: h(Portraits, { selectedUnitId: focusedUnitId }),
          top,
        }),
        h(GameGrid, { selectedUnitId: focusedUnitId }),
      ),
      h(TradeView),
      h(InfoDisplay, { unitId: focusedUnitId }),
      h(Combat),
      h(GameOverModal),
    );
  }

  const selectedUnitId = 'unit-1';
  return {
    component: GameBoard,
    iterations: 25,
    name: 'Strategy game board',
    props: { selectedUnitId },
    providers: [GameStateProvider],
    verifyDOM(root, assert) {
      assert.equal(
        root.getAttribute('data-benchmark-board'),
        `${BOARD_WIDTH}x${BOARD_HEIGHT}x${LAYER_COUNT}`,
      );
      assert.equal(
        root.querySelectorAll('[data-benchmark-tile]').length,
        strategyGameScale.tiles,
      );
      assert.equal(
        root.querySelectorAll('[data-benchmark-unit]').length,
        strategyGameScale.units,
      );
      assert.equal(
        root.querySelectorAll('[data-benchmark-mechanism]').length,
        strategyGameScale.mechanisms,
      );
      assert.equal(
        root.querySelectorAll('[data-benchmark-effect]').length,
        strategyGameScale.effects,
      );
      assert.equal(
        root.querySelectorAll('[data-inventory-item]').length,
        strategyGameScale.inventoryItems,
      );
    },
    verifyShallow(subject, assert) {
      assert.equal(subject.find(GameOverlay).exists(), true);
      assert.equal(
        subject.find(GameGrid).prop('selectedUnitId'),
        selectedUnitId,
      );
      assert.equal(subject.find(InfoDisplay).prop('unitId'), selectedUnitId);
      assert.equal(subject.find(Combat).exists(), true);
    },
  };
}
