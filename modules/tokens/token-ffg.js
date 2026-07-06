export class TokenFFG extends foundry.canvas.placeables.Token {
  /** @override */
  _refreshTurnMarker(wantMarkerActive=false) {
    CONFIG.logger.debug(`Refreshing ${this.name}...`);
    // Should a Turn Marker be active?
    const {turnMarker} = this.document;
    const markersEnabled = CONFIG.Combat.settings.turnMarker.enabled
      && (turnMarker.mode !== CONST.TOKEN_TURN_MARKER_MODES.DISABLED);

    // The combatant whose slot is currently active in the tracker.
    const activeCombatant = game.combat?.combatant;
    // Friendly slots can be claimed by a PC; the actor actually taking the turn is the claimant if
    // the slot is claimed, otherwise the slot's own combatant (the typical case for NPC slots).
    const claimedId = activeCombatant?.claimed;
    const claimant = claimedId ? game.combat?.combatants.find(i => i.id === claimedId) : undefined;
    const actingCombatant = claimant ?? activeCombatant;
    const actingActor = actingCombatant?.actor;

    // NPCs are the minion / rival / nemesis actor types (player characters use the "character"
    // type). The token turn marker is shown for NPC turns only - player turns are already conveyed
    // by the slot/claim UI in the combat tracker.
    const isNPCTurn = ["minion", "rival", "nemesis"].includes(actingActor?.type);
    // Does this token represent the acting NPC? Match the specific token when one is recorded so
    // grouped/minion tokens sharing an actor don't all light up.
    const isActingToken = !!this.actor
      && actingCombatant?.actorId === this.actor.id
      && (!actingCombatant?.tokenId || actingCombatant.tokenId === this.document.id);

    // Activate a Turn Marker
    if ((markersEnabled && wantMarkerActive) || (markersEnabled && isNPCTurn && isActingToken)) {
      if (!this.turnMarker) this.turnMarker = this.addChildAt(new foundry.canvas.placeables.tokens.TokenTurnMarker(this), 0);
      canvas.tokens.turnMarkers.add(this);
      this.turnMarker.draw();
    }
    else {
      // Remove a Turn Marker
      canvas.tokens.turnMarkers?.delete(this);
      this.turnMarker?.destroy();
      this.turnMarker = null;
    }
  }

  /** @override */
  _refreshSize() {
    this._refreshMeshSizeAndScale();

    // Adjust nameplate and tooltip positioning
    const {width, height} = this.document.getSize();

    this.nameplate.position.set(width / 2, height + 2);
    this.tooltip.position.set(width / 2, -2);

    // Adjust turn marker size (150% size by default);
    // fixes a bug where the default refreshSize does not check that this.turnMarker.mesh is defined
    if ( this.turnMarker && this.turnMarker.mesh ) {
      const mesh = this.turnMarker.mesh;
      mesh.width = mesh.height = this.externalRadius * 3;
    }
  }
}
