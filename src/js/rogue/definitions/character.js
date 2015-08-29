
import Entity from './entity';
import NumberRange from '../lib/number-range';
import Professions from '../content/professions/_all';
import Races from '../content/races/_all';
import GameState from '../init/gamestate';
import Attacks from '../content/attacks/attacks';
import MessageQueue from '../display/message-handler';

import loadValue from '../lib/value-assign';
import calc from '../lib/directional-probability';

let defaultAttributes = {
  ac:  0,
  str: 8,
  con: 8,
  dex: 8,
  int: 8,
  wis: 8,
  cha: 8,
  luk: 0,
  gold: 0,
  level: 1,
  align: 0, 
  speed: 100, 
  sight: 7,
  killXp: '0d0',
  spawnHp: '15d1',
  spawnMp: '0d0',
  regenHp: 20,
  regenMp: 10
};

let defaultStats = { 
  gender: 'None', 
  name: 'Dudley',
  race: 'Human',
  attacks: [],
  behaviors: [],
  profession: 'Wizard' 
};

export default class Character extends Entity {
  
  constructor(glyph, x, y, z, opts = { stats: {}, attributes: {} }) {
    super(glyph, x, y, z);
    
    this.factions = [];
    this.antiFactions = [];
    
    this.currentTurn = 0;
    
    _.extend(this, defaultAttributes, opts.attributes, loadValue);
    _.extend(this, defaultStats, opts.stats);
    
    this.sortBehaviors();
    
    this.professionInst = new Professions[this.profession]();
    let [profHp, profMp] = [this.professionInst.hp, this.professionInst.mp];
    this.hp = new NumberRange(0, this.spawnHp+profHp, this.spawnHp+profHp);
    this.mp = new NumberRange(0, this.spawnMp+profMp, this.spawnMp+profMp);
    this.xp = new NumberRange(0, 0, this.calcLevelXp(this.level));
    this.factions.push(...this.professionInst.addFactions);
    
    this.raceInst = new Races[this.race]();
    this.factions.push(...this.raceInst.addFactions);
    
    this.inventory = [];
    this.equipment = {};
    
    GameState.world.moveEntity(this, this.x, this.y, this.z);
    
    this.loadStartingEquipment();
     
    this.game = GameState.game;
    this.game.scheduler.add(this, true);
  }
  
  heal(roll, item) {
    let value = +dice.roll(roll);
    MessageQueue.add({ message: `${this.name} used ${item.name} and regained ${value} health!` });
    this.hp.add(value);
  }
  
  tryToStack(item) {
    if(!item.charges) return;
    let didStack = false;
    _.each(this.inventory, (testItem) => {
      if(testItem.getType() !== item.getType()) return;
      if(testItem.buc !== item.buc || testItem.enchantment !== item.enchantment) return;
      testItem.charges += item.charges;
      didStack = true;
    });
    return didStack;
  }
  
  loadStartingEquipment(list = this.professionInst.startingItems) {
    if(!list) return;
    _.each(list, (item) => {
      if(item.probability && ROT.RNG.getPercentage() > item.probability) return;
      
      let inst = null;
      if(item.choices) {
        let choice = ROT.RNG.getWeightedValue(item.choices);
        inst = item.choicesInit[choice]();
      } else {
        inst = item.init();
      }
      
      this.addToInventory(inst);
    });
  }
  
  dropItem(item) {
    GameState.world.moveItem(item, this.x, this.y, this.z);
  }
  
  addToInventory(item) {
    if(item.goldValue) {
      this.gold += item.goldValue;
      return;
    }
    if(this.tryToStack(item)) return;
    if(this.tryEquip(item)) return;
    this.inventory.push(item);
  }
  
  removeFromInventory(item) {
    this.inventory = _.without(this.inventory, item);
  }
  
  isEquipped(item) {
    let slot = item.getParentType(); 
    return _.contains(this.equipment[slot], item);
  }
  
  slotsTaken(slot) {
    if(!this.equipment[slot]) return 0;
    return _.reduce(this.equipment[slot], ((prev, item) => prev + item.slotsTaken), 0);
  }
  
  canEquip(item) {
    return this.raceInst.canEquip(this, item);
  }
  
  equip(item) {
    let slot = item.getParentType();
    if(!this.equipment[slot]) this.equipment[slot] = [];
    this.equipment[slot].push(item);
  }
  
  getWorseItemsThan(item) {
    let slot = item.getParentType();
    return _(this.equipment[slot]).filter((equip) => equip.value() < item.value() && item.bucName !== 'cursed');
  }
  
  shouldEquip(item) {
    let slot = item.getParentType();
    if(this.raceInst.slots[slot] > 0 && this.canEquip(item)) return true;
    let lowerItems = this.getWorseItemsThan(item);
    return lowerItems.length < item.slotsTaken;
  }
  
  tryEquip(item) {
    if(!this.canEquip(item) || !this.shouldEquip(item)) return false;
    let worseItems = this.getWorseItemsThan(item);
    if(worseItems.length < item.slotsTaken) return false; // cursed items
    
    let slot = item.getParentType();
    if(worseItems.length > 0) {
      for(let i=0; i<item.slotsTaken; i++) {
        this.equipment[slot] = _.without(this.equipment[slot], worseItems[i]);
        this.inventory.push(worseItems[i]);
      }
    }
    this.equip(item);
    return true;
  }
  
  hasFaction(faction) {
    return _.contains(this.factions, faction);
  }
  
  doBehavior(action, args = []) {
    args.unshift(this);
    _.each(this.behaviors, (behavior) => { if(behavior[action]) return behavior[action].apply(behavior, args); }); // returning false from any behavior will cancel subsequent ones
  }
  
  sortBehaviors() {
    this.behaviors = _.sortBy(this.behaviors, 'priority');
  }
  
  addBehavior(behavior) {
    this.behaviors.push(behavior);
    this.sortBehaviors();
  }
  
  hasBehavior(behavior) {
    return _.contains(_.pluck(this.behaviors, 'constructor.name'), behavior);
  }
  
  addUniqueBehavior(behavior) {
    if(this.hasBehavior(behavior.constructor.name)) return;
    this.addBehavior(behavior);
  }
  
  removeBehavior(behavior) {
    this.behaviors = _.without(this.behaviors, behavior);
  }
  
  takeDamage(damage, attacker) {
    this.hp.sub(damage);
    if(this.hp.atMin()) {
      this.die(attacker);
    }
  }
  
  die(killer) {
    this.doBehavior('die');
    MessageQueue.add({ message: `${this.name} was killed by ${killer.name}!` });
    killer.kill(this);
    
    this.killerName = killer.name;
    
    this.game.scheduler.remove(this);
    GameState.world.removeEntity(this);
  }
  
  kill(dead) {
    this.gainXp(dead.killXp);
    this.doBehavior('kill');
  }
  
  stepRandomly() {
    var tiles = GameState.world.getAllTilesInRange(this.x, this.y, this.z, 1);
    var validTiles = _.map(tiles, (tile, i) => GameState.world.isTileEmpty(tile.x, tile.y, tile.z) ? i+1 : null); // 1-9 instead of 0-8
    var direction = _(validTiles).compact().sample() - 1; // adjustment for array
    var newTile = tiles[direction]; // default to a random tile
    
    if(this.lastDirection) {
      let probs = calc(this.lastDirection + 1); // adjust for array
      let choices = _(validTiles).map(tileIndex => tileIndex ? [tileIndex, probs[tileIndex]] : null).compact().zipObject().value();
      direction = parseInt(ROT.RNG.getWeightedValue(choices)) - 1;
      newTile = tiles[direction];
    }
    
    if(!newTile) return; // surrounded
    this.move(newTile);
    this.lastDirection = direction;
  }
  
  stepTowards(target) {
    let path = [];
    let addPath = (x, y) => path.push({ x, y });
    target._path.compute(this.x, this.y, addPath);
    
    path.shift();
    let step = path.shift();
    if(!step) return false;
    
    let blockingEntityInfo = (path) => {
      let entity = null;
      let step = null;
      _.each(path, (step, i) => {
        let testEntity = GameState.world.getEntity(step.x, step.y, this.z);
        if(testEntity && !this.canAttack(testEntity)) {
          entity = testEntity;
          step = i;
          return false;
        }
      });
      return { entity, step };
    };
    
    let mainBlockingInfo = blockingEntityInfo(path);
    
    // the main path is blocked
    if(mainBlockingInfo.entity) {
      let altPath = this.getAlternatePathTo(target);
      
      // no alternate path could be generated
      if(!altPath) {
        this.moveTo(step.x, step.y);
        return true;
      }
      
      let altBlockingInfo = blockingEntityInfo(altPath);

      // both are blocked, take the shortest path
      if(mainBlockingInfo.entity && altBlockingInfo.entity) {
        let newPath = _.min([path, altPath], (testPath) => testPath.length);
        let newStep = newPath.shift();
        this.moveTo(newStep.x, newStep.y);
        
      // the alt path isn't blocked, take that
      } else {
        let newStep = altPath.shift();
        this.moveTo(newStep.x, newStep.y);
      }
      
    // no blockers, keep moving on
    } else {
      this.moveTo(step.x, step.y);
    }
    
    return true;
  }
  
  getAlternatePathTo(target) {
    let canPass = (x, y) => {
      let entity = GameState.world.getEntity(x, y, this.z);
      let isAttackable = entity && this.canAttack(entity);
      let isMe = this.x === x && this.y === y;
      return GameState.world.isTilePassable(x, y, this.z) || isMe || isAttackable;
    };
    let astar = new ROT.Path.AStar(target.x, target.y, canPass);
    
    let path = [];
    astar.compute(this.x, this.y, (x, y) => path.push({ x, y }));
    
    path.shift();
    let step = path.shift();
    if(!step) return null;
    return path;
  }
  
  canAttack(entity) {
    return _.intersection(entity.factions, this.antiFactions).length > 0;
  }
  
  doAttack(attack, hitNum) {
    let target = attack.possibleTargets(this)[0];
    if(!target) return; // possibly a multi-shot attack that has killed early
    attack.use(this, target, hitNum);
  }
  
  tryAttack() {
    let attacks = this.getAttacks();
    if(attacks.length === 0) return false;
    
    _.each(attacks, this.doAttack, this);
    return true;
  }
  
  act() {
    this.currentTurn++;
    if(this.currentTurn % this.regenHp === 0) this.hp.add(1);
    if(this.currentTurn % this.regenMp === 0) this.mp.add(1);
    this.doBehavior('act');
  }
  
  moveTo(x, y) {
    return GameState.world.moveEntity(this, x, y, this.z);
  }
  
  move(newTile) {
    return GameState.world.moveEntity(this, newTile.x, newTile.y, newTile.z);
  }
  
  calcLevelXp(level) {
    return 10 * Math.pow(2, level);
  }
  
  calcLevelHpBonus() {
    return +dice.roll(this.professionInst.config.hp) + this.calcStatBonus('con');
  }
  
  calcLevelMpBonus() {
    return +dice.roll(this.professionInst.config.mp) + this.calcStatBonus('int');
  }
  
  gainXp(number) {
    this.xp.add(number);
    if(this.xp.atMax()) {
      this.levelup();
    }
  }
  
  getAlign() {
    if(this.align <= -100) return 'Evil';
    if(this.align >= 100) return 'Good';
    return 'Neutral';
  }
  
  levelup() {
    this.professionInst.levelup();
    this.level += 1;
    this.hp.max += this.calcLevelHpBonus();
    this.mp.max += this.calcLevelMpBonus();
    this.xp.max = this.calcLevelXp(this.level);
    
    // resets
    this.xp.cur = 0;
    this.hp.cur = this.hp.max;
    this.mp.cur = this.mp.max;
    
    MessageQueue.add({ message: `${this.name} has reached experience level ${this.level}!` });
  }
  
  rollOrAdd(val) {
    val = _.isString(val) ? +dice.roll(val) : val;
    return !val || _.isNaN(val) ? 0 : val;
  }
  
  getAttacks() {
    let baseAttacks = this.attacks || [];
    let attacks = baseAttacks.concat(_(this.equipment).values().flatten().filter((item) => item.canUse(this) && item.attacks).pluck('attacks').flatten().value());
    if(attacks.length === 0) attacks = [Attacks.Unarmed()];
    let inventoryAttacks = _(this.inventory).filter((item) => item.canUse(this) && item.attacks).pluck('attacks').flatten().value();
    
    // all melee attacks are valid, but only one ranged inventory attack can be used
    if(_.some(attacks, (atk) => atk.canUse(this))) return attacks;
    return _.compact([_(inventoryAttacks).filter((atk) => atk.canUse(this)).sample()]);
  }
  
  getStat(stat) {
    return this.rollOrAdd(this[stat]) + this.rollOrAdd(this.professionInst[stat]);
  }
  
  getBonusDamage() {
    return this.getStat('bonusDamage');
  }
  
  getToHit() {
    return this.getStat('toHit');
  }
  
  getSight() {
    return this.getStat('sight');
  }
  
  getSpeed() {
    return this.getStat('speed');
  }
  
  getAC() {
    return 10 + this.getStat('ac') - this.calcStatBonus('dex');
  }
  
  getStr() {
    return this.getStat('str');
  }
  
  getDex() {
    return this.getStat('dex');
  }
  
  getCon() {
    return this.getStat('con');
  }
  
  getInt() {
    return this.getStat('int');
  }
  
  getWis() {
    return this.getStat('wis');
  }
  
  getCha() {
    return this.getStat('cha');
  }
  
  getLuk() {
    return this.getStat('luk');
  }
  
  // -2 = 4/5, -1 = 6/7, 0 = 8, +1 = 9/10, +2 = 10/11 (etc)
  calcStatBonus(stat) {
    return Math.floor(this[`get${_.capitalize(stat)}`]() / 2) - 4;
  }
  
  toJSON() {
    let me = _.omit(this, ['game', '_path']);
    return JSON.stringify(me);
  }
}