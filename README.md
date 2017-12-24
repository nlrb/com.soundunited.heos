# D&M Heos

Control your Denon/Marantz Heos devices with Homey.

_This app is based on the Denon Heos app from Athom._

#### Features

The following items are changes to the offical Homey app:
* __Robustness__: Players can go offline and come back online without issue
* __Control__: The mobile card now also enables to (un)mute or stop playback
* __Information__: The device settings shows information about the devices
* __Triggers__: Flow triggers are available (start, stop, pause, now playing)
* __Media__: The Heos speakers can be selected as a Homey speaker in Media (only URL streaming supported now)

#### Known (Homey) issues
* The initial state of a device can be shown as unknown (while the values have been set correctly)
* The play/pause state in media can get out-of-sync with the speaker state

_The intent is that these changes are merged into the official Heos app from Athom (if they are willing)._
