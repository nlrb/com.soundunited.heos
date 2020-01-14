'use strict'

const Homey	= require('homey')
const DenonHeos = require('denon-heos').DenonHeos

const repeatMap = { none: 'off', track: 'on_one', playlist: 'on_all' };
const repeatMapR = { off: 'none', on_one: 'track', on_all: 'playlist' };


const http = require('http');

module.exports = class HeosDevice extends Homey.Device {

	// To be able to handle http/local URLs as well
	setHomeyImage(url) {
		return this.image.setStream(data => {
			http.request(url, response => {
				response.on('data', chunk => { data.push(chunk); });
			  response.on('end', () => { data.read(); data.destroy(); });
			}).end();
		})
	}

	async onInit() {
		this.mediaActive = false
    this.id = await this.getData().id
    this.driver = await this.getDriver()
    if (!this.driver.getPlayerAvailable(this.id)) {
      this.setUnavailable('No connection')
    } else {
      this.setValues()
    }

		// For backward compatibility: add capabilities that were previously not there
		let deviceCap = this.getCapabilities();
		let currentCap = this.driver.getManifest().capabilities;
		for (let c in currentCap) {
			if (!deviceCap.includes(currentCap[c])) {
				this.log('Adding capability', currentCap[c], 'to device', this.getName());
				this.addCapability(currentCap[c]).catch(this.error);
			}
		}
		for (let c in deviceCap) {
			if (!currentCap.includes(deviceCap[c])) {
				this.log('Removing capability', deviceCap[c], 'from device', this.getName());
				this.removeCapability(deviceCap[c]).catch(this.error);
			}
		}

    // Homey flow handling - triggers
    const triggers = ['play', 'pause', 'stop', 'now_playing']
    this.triggers = {}
    for (let t in triggers) {
      this.triggers[triggers[t]] = new Homey.FlowCardTriggerDevice(triggers[t])
      this.triggers[triggers[t]].register()
    }

		// Homey flow handling - actions
		let favouriteAction = new Homey.FlowCardAction('play_favourite');
    favouriteAction
      .register()
      .registerRunListener((args, state) => {
        // heos://browse/play_preset?pid=player_id&preset=preset_position
				this.log('Favourite action listener', args.favourite)
				// Important! this.id != args.device.id
				return this.driver.sendPlayerCommand(args.device.id, 'player/play_preset', { preset: args.favourite.preset })
      })
      .getArgument('favourite')
      .registerAutocompleteListener(async (query, args) => {
				// Get Heos favourites
				let favourites = await this.driver.sendCommand('browse/browse', { sid: 1028 })
				if (favourites && favourites.length > 0) {
					let result = []
					let cnt = 1
					for (let cnt = 0; cnt < favourites.length; cnt++) {
						let fav = favourites[cnt]
						if (fav.name.toLowerCase().indexOf(query.toLowerCase()) >= 0) {
							result.push({
								image: fav.image_url,
								name: fav.name,
								type: fav.type,
								preset: cnt + 1
							})
						}
					}
					this.log('Result', result)
					return Promise.resolve(result)
				} else {
					return Promise.reject(favourites.text || 'Error')
				}
			})

			let urlAction = new Homey.FlowCardAction('play_url');
	    urlAction
	      .register()
	      .registerRunListener((args, state) => {
					this.log('URL action listener', args.url);
					// Important! this.id != args.device.id
					return this.driver.sendPlayerCommand(args.device.id, 'browse/play_stream', { url: args.url });
	      })

    // Register driver event handlers
    this.handlers = {
      'available': this.onAvailable,
      'unavailable': this.onUnavailable,
    }
    this.handlers[this.id] = this.onEvent

    for (let h in this.handlers) {
      this.handlers[h] = this.handlers[h].bind(this)
      this.driver.on(h, this.handlers[h])
    }

    // Register capability listeners
    this.registerCapabilityListener('speaker_prev', (state) => {
			return this.driver.sendPlayerCommand(this.id, 'player/play_previous');
		});
		this.registerCapabilityListener('speaker_next', (state) => {
			return this.driver.sendPlayerCommand(this.id, 'player/play_next');
		});
    this.registerCapabilityListener('speaker_playing', (state) => {
      return this.driver.sendPlayerCommand(this.id, 'player/set_play_state', { state: (state ? 'play' : 'pause') })
    });
		this.registerCapabilityListener('volume_mute', (mute) => {
      return this.driver.sendPlayerCommand(this.id, 'player/set_mute', { state: (mute ? 'on' : 'off') })
    });
    this.registerCapabilityListener('volume_set', (volume) => {
      return this.driver.sendPlayerCommand(this.id, 'player/set_volume', { level: 100 * volume })
    });
		this.registerCapabilityListener('speaker_shuffle', (onoff) => {
      return this.driver.sendPlayerCommand(this.id, 'player/set_play_mode', { shuffle: (onoff ? 'on' : 'off') })
    })
		this.registerCapabilityListener('speaker_repeat', (repeat) => {
      return this.driver.sendPlayerCommand(this.id, 'player/set_play_mode', { repeat: repeatMap[repeat] })
    })

		this.image = new Homey.Image();
    this.image.setUrl(null);
    this.image.register()
    	.then(() => { return this.setAlbumArtImage(this.image); })
    	.catch(this.error);

  /*
    // These are all standard actions for default capabilities already
    const actions = {
      'start': () => this.driver.sendPlayerCommand(this.id, 'player/set_play_state', { state: 'play' }),
      'pause': () => this.driver.sendPlayerCommand(this.id, 'player/set_play_state', { state: 'pause' }),
      'stop': () => this.driver.sendPlayerCommand(this.id, 'player/set_play_state', { state: 'stop' }),
      'prev': () => this.driver.sendPlayerCommand(this.id, 'player/play_previous'),
      'next': () => this.driver.sendPlayerCommand(this.id, 'player/play_next'),
      'volume_set': (args, state) => this.driver.sendPlayerCommand(this.id, 'player/set_volume', { level: 100 * args.volume })
    }

    for (let a in actions) {
      let newAction = new Homey.FlowCardAction(a)
      newAction
        .register()
        .registerRunListener(actions[a])
    }
    */
/*
		// Integrate into Homey Media as speaker
		this.speaker = new Homey.Speaker(this)

    // Set listeners and register speaker
    this.speaker
			.on('setTrack', this.mediaSetTrack.bind(this))
    	.on('setPosition', this.mediaSetPosition.bind(this))
    	.on('setActive', this.mediaSetSpeakerActive.bind(this))
			.register({ codecs: ['homey:codec:mp3', 'homey:codec:flac'] })
*/
  }

  onDeleted() {
    this.log('Removing listeners')
    for (let h in this.handlers) {
      this.driver.removeListener(h, this.handlers[h])
    }
  }

  onAvailable(id) {
    if (id === this.id) {
      this.setAvailable()
      this.setValues()
			// Check if settings need to be updated (e.g. firmware change)
			let settings = this.getSettings()
			let newSettings = this.driver.getPlayerVolatileSettings(this.id)
			let update = false
			for (let key in newSettings) {
				update = update || (newSettings[key] !== settings[key])
			}
			if (update) {
				Object.assign(settings, newSettings)
				this.setSettings(settings)
			}
    }
  }

  onUnavailable(id) {
    if (id === this.id) {
      this.setUnavailable('No connection')
    }
  }

  async onEvent(action, message) {
    switch (action) {
      case 'player_state_changed': {
        this.log('New state is', message.state)
        let state = message.state === 'play'
        this.setCapabilityValue('speaker_playing', state).catch(this.error);
        this.triggers[message.state].trigger(this)
        break
      }
			case 'repeat_mode_changed': {
				this.setCapabilityValue('speaker_repeat', repeatMapR[message.repeat]).catch(this.error);
				break;
			}
			case 'shuffle_mode_changed': {
				this.setCapabilityValue('speaker_shuffle', message.shuffle === 'on').catch(this.error);
				break;
			}
      case 'player_now_playing_changed': {
        this.log('Retreiving playing media')
        try {
          let result = await this.driver.sendPlayerCommand(this.id, 'player/get_now_playing_media').catch(this.error);
          let tokens = {
            song: result.song,
            artist: (result.type === 'station' ? result.station : result.artist),
            album: result.album
          }
					// Update capability values
					this.setCapabilityValue('speaker_artist', tokens.artist).catch(this.error);
					this.setCapabilityValue('speaker_album', tokens.album).catch(this.error);
					this.setCapabilityValue('speaker_track', tokens.song).catch(this.error);
					// Update album art image, only https URLs are supported
					let url = result.image_url;
					this.log('URL:', url);
					if (url.startsWith('https')) {
						this.image.setUrl(url);
					} else if (url.startsWith('http')) {
						this.setHomeyImage(url);
					} else {
						this.image.setUrl(null);
					}
					this.image.update().catch(this.error);
					// Send trigger
          this.triggers.now_playing.trigger(this, tokens)
            .then(this.log('Sent trigger now_playing with token', tokens))
        } catch (err) {
          this.log('Error:', err)
        }
        break
      }
      case 'player_volume_changed': {
        this.setCapabilityValue('volume_set', message.level / 100)
        this.setCapabilityValue('volume_mute', message.mute === 'on')
        break
      }
      case 'player_now_playing_progress': {
				this.setCapabilityValue('speaker_position', Number(message.cur_pos)).catch(this.error);
				this.setCapabilityValue('speaker_duration', Number(message.duration)).catch(this.error);
        break;
      }
			case 'player_playback_error': {
				if (this.mediaActive) {
					// Stop playback if we cannot play the requested stream
					this.driver.sendPlayerCommand(this.id, 'player/set_play_state', { state: 'stop' })
						.catch(this.error)
				}
				break
			}
      default: {
        this.log('Ignoring action:', action)
        break
      }
    }
  }

  setValues() {
    // Initialize state
    this.driver.sendPlayerCommand(this.id, 'player/get_volume')
			.then(data => {
				this.setCapabilityValue('volume_set', data.level / 100)
					.catch(e => this.error('volume_set', e))
				})
			.catch(this.error);
		this.driver.sendPlayerCommand(this.id, 'player/get_mute')
			.then(data => {
				this.setCapabilityValue('volume_mute', data.state === 'on')
					.catch(e => this.error('volume_mute', e))
				})
    	.catch(this.error);
    this.driver.sendPlayerCommand(this.id, 'player/get_play_state')
			.then(data => {
				this.setCapabilityValue('speaker_playing', data.state === 'play')
					.catch(e => this.error('speaker_playing', e))
				})
			.catch(this.error);
		this.driver.sendPlayerCommand(this.id, 'player/get_play_mode')
			.then(data => {
				this.emit('repeat_mode_changed', data);
				this.emit('shuffle_mode_changed', data);
    	})
			.catch(this.error);
		this.onEvent('player_now_playing_changed');
  }

	mediaSetTrack(data, callback) {
		this.log(data)
		if (data.track.stream_url) {
			this.log('Starting stream', data.track.stream_url)
			this.driver.sendPlayerCommand(this.id, 'browse/play_stream', { url: data.track.stream_url })
				.catch(this.log)
				.then(() => {
					callback(null, true)
				})
		}
	}

	mediaSetPosition(position, callback) {
		callback(null, false) // not supported
	}

	mediaSetSpeakerActive(isActive, callback) {
		this.mediaActive = isActive
    if (isActive) {
			// Speaker is active for Homey as source; stop current playback if playing
			if (this.getCapabilityValue('speaker_playing') !== 'stop') {
				this.driver.sendPlayerCommand(this.id, 'player/set_play_state', { state: 'stop' })
					.catch(this.log)
			}
		}
		callback(null, isActive)
	}

}
