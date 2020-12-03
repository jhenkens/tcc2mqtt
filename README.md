# homebridge-tcc
This is a fork of homebridge-tcc, using it's libraries to implement a what I am currently calling tcc2mqtt - an MQTT adapter for Honeywell TCC thermostats. Very much a WIP

## Long term goals
I hope to be able to contribute modifications back to the library used upstream in a compatible way, and get the library published via NPM. Thus, I can properly make tcc2mqtt depend on it via package, and reduce duplicate maintenance of the TCC specific SOAP APIs.

## Usage
See [npm package rc](https://www.npmjs.com/package/rc) for information on where to put your config files. You can see `config.js` for the available config options.

I use a forked version of ansible-nas, and here is the relevant parts (fill in your own variables) to create and run the container.

```
- name: Create TCC2MQTT Directories
  file:
    path: "{{ item }}"
    state: directory
    # mode: 0755
  with_items:
    - "{{ tcc2mqtt_data_directory }}"

- name: Clone tcc2mqtt repo
  git:
    repo: '{{ tcc2mqtt_repo }}'
    dest: '{{ tcc2mqtt_data_directory }}/repo'

- name: Build tcc2mqtt image
  docker_image:
    build:
      path: "{{ tcc2mqtt_data_directory }}/repo"
    name: ansible-nas/tcc2mqtt
    tag: latest
    state: present

- name: TCC2MQTT Docker Container
  docker_container:
    name: tcc2mqtt
    image: ansible-nas/tcc2mqtt:latest
    volumes:
      - "{{ tcc2mqtt_data_directory }}/config.json:/etc/tcc2mqtt/config:rw"
    env:
      TZ: "{{ ansible_nas_timezone }}"
    restart_policy: unless-stopped
    memory: 1g
```
