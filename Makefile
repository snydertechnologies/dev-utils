#!make
MAKEFLAGS += --silent --jobs=15

##################################################################
## WARNING: assumes that .zsh_config is sourced!
##################################################################

###
### Environment
###

environment ?= development
export DOTENV_EXPAND_PREFIXES=MYENV_,ASPNETCORE_,DOTNET_,NODE_,PRODUCTION,WORKING_ENV
_ := $(shell bunx dotenv-cli -e .config/environment/.$(environment).env -- bun --bun ./nx/dotenv-expand-transpiler.ts ./ .env false >&2)
include .env
export $(shell sed 's/=.*//' .env)

EnvCmd = dotenv .config/environment/.$(environment).env
RebookPorts = 5000

# trick variables
noop =
comma := ,
space = $(noop) $(noop)

###
### Targets
###

install:
#	deno install --unstable --no-check -qrfAn dx https://deno.land/x/deno_dx@0.3.1/cli.ts
#	dx ensureUtilsAreInstalled
