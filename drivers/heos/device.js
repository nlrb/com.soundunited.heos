'use strict'

const Homey	= require('homey')
const DenonHeos = require('denon-heos').DenonHeos


module.exports = class HeosDevice extends Homey.Device {

	async onInit() {
		this.mediaActive = false
    this.id = await this.getData().id
    this.driver = await this.getDriver()
    if (!this.driver.getPlayerAvailable(this.id)) {
      this.setUnavailable('No connection')
    } else {
      this.setValues()
    }

    // Homey flow handling - triggers
    const triggers = ['play', 'pause', 'stop', 'now_playing']
    this.triggers = {}
    for (let t in triggers) {
      this.triggers[triggers[t]] = new Homey.FlowCardTriggerDevice(triggers[t])
      this.triggers[triggers[t]].register()
    }

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
    this.registerCapabilityListener('speaker_ctrl', (state) => {
      if (state === 'speaker_prev') {
        return this.driver.sendCommand(this.id, 'player/play_previous')
      } else if (state === 'speaker_next') {
        return this.driver.sendCommand(this.id, 'player/play_next')
      } else {
        return this.driver.sendCommand(this.id, 'player/set_play_state', { state: 'stop' })
      }
      return this.driver.sendCommand(this.id, 'player/play_previous')
    })
    this.registerCapabilityListener('speaker_playing', (state) => {
      return this.driver.sendCommand(this.id, 'player/set_play_state', { state: (state ? 'play' : 'pause') })
    })
		this.registerCapabilityListener('volume_mute', (mute) => {
      return this.driver.sendCommand(this.id, 'player/set_mute', { state: (mute ? 'on' : 'off') })
    })
    this.registerCapabilityListener('volume_set', (volume) => {
      return this.driver.sendCommand(this.id, 'player/set_volume', { level: 100 * volume })
    })

    /*
    // These are all standard actions for default capabilities already
    const actions = {
      'start': () => this.driver.sendCommand(this.id, 'player/set_play_state', { state: 'play' }),
      'pause': () => this.driver.sendCommand(this.id, 'player/set_play_state', { state: 'pause' }),
      'stop': () => this.driver.sendCommand(this.id, 'player/set_play_state', { state: 'stop' }),
      'prev': () => this.driver.sendCommand(this.id, 'player/play_previous'),
      'next': () => this.driver.sendCommand(this.id, 'player/play_next'),
      'volume_set': (args, state) => this.driver.sendCommand(this.id, 'player/set_volume', { level: 100 * args.volume })
    }

    for (let a in actions) {
      let newAction = new Homey.FlowCardAction(a)
      newAction
        .register()
        .registerRunListener(actions[a])
    }
    */

		// Integrate into Homey Media as speaker
		this.speaker = new Homey.Speaker(this)

    // Set listeners and register speaker
    this.speaker
			.on('setTrack', this.mediaSetTrack.bind(this))
    	.on('setPosition', this.mediaSetPosition.bind(this))
    	.on('setActive', this.mediaSetSpeakerActive.bind(this))
			.register({ codecs: ['homey:codec:mp3', 'homey:codec:flac'] })
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
        this.setCapabilityValue('speaker_playing', state)
        this.triggers[message.state].trigger(this)
        break
      }
      case 'player_now_playing_changed': {
        this.log('Retreiving playing media')
        try {
          let result = await this.driver.sendCommand(this.id, 'player/get_now_playing_media')
          let tokens = {
            song: result.song,
            artist: (result.type === 'station' ? result.station : result.artist),
            album: result.album
          }
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
				if (this.mediaActive) {
					this.speaker.updateState({ position: Number(message.cur_pos) })
				}
        break
      }
			case 'player_playback_error': {
				if (this.mediaActive) {
					// Stop playback if we cannot play the requested stream
					this.driver.sendCommand(this.id, 'player/set_play_state', { state: 'stop' })
						.catch(this.log)
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
    this.driver.sendCommand(this.id, 'player/get_volume', (data) => {
      this.setCapabilityValue('volume_set', data.level / 100)
    })
    this.driver.sendCommand(this.id, 'player/get_play_state', (data) => {
      this.setCapabilityValue('speaker_playing', data.state === 'play')
    })
    this.driver.sendCommand(this.id, 'player/get_mute', (data) => {
      this.setCapabilityValue('volume_mute', data.state === 'on')
    })
  }

	mediaSetTrack(data, callback) {
		this.log(data)
		if (data.track.stream_url) {
			this.log('Starting stream', data.track.stream_url)
			this.driver.sendCommand(this.id, 'browse/play_stream', { url: data.track.stream_url })
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
				this.driver.sendCommand(this.id, 'player/set_play_state', { state: 'stop' })
					.catch(this.log)
			}
		}
		callback(null, isActive)
	}

}
