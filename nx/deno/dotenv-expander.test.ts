import { assertEquals } from "https://deno.land/std@0.204.0/assert/mod.ts";
import { processConfigFile, log } from "./test.ts";
import { load } from "https://deno.land/std@0.204.0/dotenv/mod.ts";
import {expand, DotenvExpandOptions} from 'npm:dotenv-expand';
// import {DotenvExpandOptions, DotenvExpandOutput} from 'npm:dotenv-expand';

interface IObj {
  [key: string]: string | undefined;
}

const res = await fetch('https://raw.githubusercontent.com/motdotla/dotenv-expand/master/tests/.env');
const envData = await res.text();
function parsedObj(): DotenvExpandOptions {
  const envObj = Object.fromEntries(envData.split('\n').map(line => line.split('=')));
  return { parsed: envObj };
}

function runTests() {
  log("Running tests...");

  Deno.test("dotenv-expand: returns object", () => {
    const dotenv = { parsed: {} };
    const testObj:IObj = expand(dotenv).parsed!;
    assertEquals(typeof testObj, "object");
  });

  Deno.test("dotenv-expand: expands environment variables", () => {
    const dotenv = {
      parsed: {
        BASIC: "basic",
        BASIC_EXPAND: "${BASIC}",
        BASIC_EXPAND_SIMPLE: "$BASIC",
      },
    };
    const testObj:IObj = expand(dotenv).parsed!;
    assertEquals(testObj.BASIC_EXPAND, "basic");
    assertEquals(testObj.BASIC_EXPAND_SIMPLE, "basic");
  });

  Deno.test("expands environment variables existing already on the machine", () => {
    Deno.env.set("MACHINE", "machine");
    const dotenv = {
      parsed: {
        MACHINE_EXPAND: "${MACHINE}",
        MACHINE_EXPAND_SIMPLE: "$MACHINE",
      },
    };
    const testObj: IObj | undefined  = expand(dotenv).parsed;

    assertEquals(testObj?.MACHINE_EXPAND, "machine");
    assertEquals(testObj?.MACHINE_EXPAND_SIMPLE, "machine");
  });

  Deno.test("expands missing environment variables to an empty string", () => {
    const dotenv = {
      parsed: {
        UNDEFINED_EXPAND: '$UNDEFINED_ENV_KEY'
      }
    }
    const obj: IObj = expand(dotenv).parsed!;
    assertEquals(obj.UNDEFINED_EXPAND, '');
  });

  Deno.test("prioritizes machine key expansion over .env", () => {
    Deno.env.set("MACHINE", "machine");
    const dotenv = {
      parsed: {
        MACHINE: 'machine_env',
        MACHINE_EXPAND: '$MACHINE'
      }
    }
    const obj: IObj = expand(dotenv).parsed!;
    assertEquals(obj.MACHINE_EXPAND, 'machine');
  });

  Deno.test("does not expand escaped variables", () => {
    const dotenv = {
      parsed: {
        ESCAPED_EXPAND: '\\$ESCAPED'
      }
    }
    const obj: IObj = expand(dotenv).parsed!;
    assertEquals(obj.ESCAPED_EXPAND, '$ESCAPED');
  });

  Deno.test("does not expand inline escaped dollar sign", () => {
    const dotenv = {
      parsed: {
        INLINE_ESCAPED_EXPAND: 'pa\\$\\$word'
      }
    }
    const obj: IObj = expand(dotenv).parsed!;
    assertEquals(obj.INLINE_ESCAPED_EXPAND, 'pa$$word');
  });

  Deno.test("does not overwrite preset variables", () => {
    Deno.env.set("SOME_ENV", "production");
    const dotenv = {
      parsed: {
        SOME_ENV: 'development'
      }
    }
    const obj: IObj = expand(dotenv).parsed!;
    assertEquals(obj.SOME_ENV, 'production');
  });

  Deno.test("does not expand inline escaped dollar sign", () => {
    const dotenv = {
      parsed: {
        INLINE_ESCAPED_EXPAND_BCRYPT: '\\$2b\\$10\\$OMZ69gxxsmRgwAt945WHSujpr/u8ZMx.xwtxWOCMkeMW7p3XqKYca'
      }
    }
    const obj: IObj = expand(dotenv).parsed!;
    assertEquals(obj.INLINE_ESCAPED_EXPAND_BCRYPT, '$2b$10$OMZ69gxxsmRgwAt945WHSujpr/u8ZMx.xwtxWOCMkeMW7p3XqKYca');
  });

  Deno.test("handle mixed values", () => {
    const dotenv = {
      parsed: {
        PARAM1: '42',
        MIXED_VALUES: '\\$this$PARAM1\\$is${PARAM1}'
      }
    }
    const obj: IObj = expand(dotenv).parsed!;
    assertEquals(obj.MIXED_VALUES, '$this42$is42');
  });

  let dotenv = {};

  Deno.test({
    name: "Setup",
    fn: async () => {
      // Fetch the remote .env file
      const res = await fetch('https://raw.githubusercontent.com/motdotla/dotenv-expand/master/tests/.env');
      if (!res.ok) {
        throw new Error('Failed to fetch remote .env file');
      }
      const envData = await res.text();

      // Write the remote .env file's contents to a local file
      const tempDir = await Deno.makeTempDir();
      const tempFilePath = tempDir + "/dotenv-expand-test.env";
      await Deno.writeTextFile(tempFilePath, envData);

      // Now use dotenv to load the environment variables from the local file
      dotenv = await load({ envPath: tempFilePath, export: false });
    },
    sanitizeResources: false,
    sanitizeOps: false,
  });

  Deno.test("expands environment variables", () => {
    expand(dotenv);
    assertEquals(Deno.env.get("BASIC_EXPAND"), "basic");
  });

  Deno.test("expands environment variables existing already on the machine", () => {
    Deno.env.set("MACHINE", "machine");
    expand(dotenv);
    assertEquals(Deno.env.get("MACHINE_EXPAND"), "machine");
  });

  Deno.test('expands missing environment variables to an empty string', () => {
    const obj: IObj | undefined  = expand(dotenv).parsed;
    assertEquals(obj?.UNDEFINED_EXPAND, undefined);
  });

  Deno.test('expands environment variables existing already on the machine even with a default', () => {
    Deno.env.set('MACHINE', 'machine');
    expand(parsedObj());
    assertEquals(Deno.env.get('DEFINED_EXPAND_WITH_DEFAULT'), 'machine');
  });

  Deno.test('expands environment variables existing already on the machine even with a default when nested', () => {
    Deno.env.set('MACHINE', 'machine');
    expand(dotenv);
    assertEquals(Deno.env.get('DEFINED_EXPAND_WITH_DEFAULT_NESTED'), 'machine');
  });

  Deno.test('expands environment variables undefined with one already on the machine even with a default when nested', () => {
    Deno.env.set('MACHINE', 'machine');
    expand(dotenv);
    assertEquals(Deno.env.get('UNDEFINED_EXPAND_WITH_DEFINED_NESTED'), 'machine');
  });

  // Deno.test('expands missing environment variables to an empty string but replaces with default', () => {
  //   const obj: IObj | undefined = expand(dotenv).parsed;
  //   assertEquals(obj?.UNDEFINED_EXPAND_WITH_DEFAULT, 'default');
  // });

  Deno.test('expands environment variables and concats with default nested', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.DEFINED_EXPAND_WITH_DEFAULT_NESTED_TWICE, 'machinedefault');
  });

  Deno.test('expands missing environment variables to an empty string but replaces with default nested', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.UNDEFINED_EXPAND_WITH_DEFAULT_NESTED, 'default');
  });

  Deno.test('expands missing environment variables to an empty string but replaces with default nested twice', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.UNDEFINED_EXPAND_WITH_DEFAULT_NESTED_TWICE, 'default');
  });

  Deno.test('prioritizes machine key expansion over .env', () => {
    Deno.env.set('MACHINE', 'machine');
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.MACHINE_EXPAND, 'machine');
  });

  Deno.test('multiple expand', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.MONGOLAB_URI, 'mongodb://username:password@abcd1234.mongolab.com:12345/heroku_db');
  });

  Deno.test('should expand recursively', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.MONGOLAB_URI_RECURSIVELY, 'mongodb://username:password@abcd1234.mongolab.com:12345/heroku_db');
  });

  Deno.test('multiple expand', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.WITHOUT_CURLY_BRACES_URI, 'mongodb://username:password@abcd1234.mongolab.com:12345/heroku_db');
  });

  Deno.test('should expand recursively', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.WITHOUT_CURLY_BRACES_URI_RECURSIVELY, 'mongodb://username:password@abcd1234.mongolab.com:12345/heroku_db');
  });

  Deno.test('should not write to process.env if ignoreProcessEnv is set', () => {
    const dotenv = {
      ignoreProcessEnv: true,
      parsed: {
        SHOULD_NOT_EXIST: 'testing'
      }
    };
    const obj: IObj | undefined = expand(dotenv).parsed;
    const evaluation = typeof Deno.env.get('SHOULD_NOT_EXIST');
    assertEquals(obj?.SHOULD_NOT_EXIST, 'testing');
    assertEquals(evaluation, 'undefined');
  });

  Deno.test('expands environment variables existing already on the machine even with a default with special characters', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.DEFINED_EXPAND_WITH_DEFAULT_WITH_SPECIAL_CHARACTERS, 'machine');
  });

  Deno.test('should expand with default value correctly', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.UNDEFINED_EXPAND_WITH_DEFAULT_WITH_SPECIAL_CHARACTERS, '/default/path:with/colon');
    assertEquals(obj?.WITHOUT_CURLY_BRACES_UNDEFINED_EXPAND_WITH_DEFAULT_WITH_SPECIAL_CHARACTERS, '/default/path:with/colon');
  });

  Deno.test('should expand with default nested value correctly', () => {
    const obj: IObj | undefined = expand(dotenv).parsed;
    assertEquals(obj?.UNDEFINED_EXPAND_WITH_DEFAULT_WITH_SPECIAL_CHARACTERS_NESTED, '/default/path:with/colon');
  });





  Deno.test("Parse and expand recursive environment variables", () => {

    const recursiveSortContent = `
    NNR_A_01=\${NNR_A_30}
    NNR_A_02=\${NNR_A_01}\${NNR_A_03}
    NNR_A_03=\${NNR_A_04}3
    NNR_A_04=\${NNR_A_05}4
    NNR_A_05=\${NNR_A_06}5
    NNR_A_06=\${NNR_A_07}6
    NNR_A_07=\${NNR_A_08}7
    NNR_A_08=\${NNR_A_09}8
    NNR_A_09=\${NNR_A_10}9
    NNR_A_10=\${NNR_A_11}10
    NNR_A_11=\${NNR_A_12}11
    NNR_A_12=\${NNR_A_13}12
    NNR_A_13=\${NNR_A_14}13
    NNR_A_14=\${NNR_A_15}14
    NNR_A_15=\${NNR_A_16}15
    NNR_A_16=\${NNR_A_17}16
    NNR_A_17=\${NNR_A_18}17
    NNR_A_18=\${NNR_A_19}18
    NNR_A_19=\${NNR_A_20}19
    NNR_A_20=\${NNR_A_21}20
    NNR_A_21=\${NNR_A_22}21
    NNR_A_22=\${NNR_A_23}22
    NNR_A_23=\${NNR_A_24}23
    NNR_A_24=\${NNR_A_25}24
    NNR_A_25=\${NNR_A_26}25
    NNR_A_26=\${NNR_A_27}26
    NNR_A_27=\${NNR_A_28}27
    NNR_A_28=\${NNR_A_29}28
    NNR_A_29=\${NNR_A_30}29
    NNR_A_30=30
    `;

    let parsedContent = processConfigFile(recursiveSortContent);

    assertEquals(parsedContent.NNR_A_01, "30");
    assertEquals(parsedContent.NNR_A_02, "303029282726252423222120191817161514131211109876543");
    assertEquals(parsedContent.NNR_A_03, "3029282726252423222120191817161514131211109876543");
    assertEquals(parsedContent.NNR_A_04, "302928272625242322212019181716151413121110987654");
    assertEquals(parsedContent.NNR_A_05, "30292827262524232221201918171615141312111098765");
    assertEquals(parsedContent.NNR_A_06, "3029282726252423222120191817161514131211109876");
    assertEquals(parsedContent.NNR_A_07, "302928272625242322212019181716151413121110987");
    assertEquals(parsedContent.NNR_A_08, "30292827262524232221201918171615141312111098");
    assertEquals(parsedContent.NNR_A_09, "3029282726252423222120191817161514131211109");
    assertEquals(parsedContent.NNR_A_10, "302928272625242322212019181716151413121110");
    assertEquals(parsedContent.NNR_A_11, "3029282726252423222120191817161514131211");
    assertEquals(parsedContent.NNR_A_12, "30292827262524232221201918171615141312");
    assertEquals(parsedContent.NNR_A_13, "302928272625242322212019181716151413");
    assertEquals(parsedContent.NNR_A_14, "3029282726252423222120191817161514");
    assertEquals(parsedContent.NNR_A_15, "30292827262524232221201918171615");
    assertEquals(parsedContent.NNR_A_16, "302928272625242322212019181716");
    assertEquals(parsedContent.NNR_A_17, "3029282726252423222120191817");
    assertEquals(parsedContent.NNR_A_18, "30292827262524232221201918");
    assertEquals(parsedContent.NNR_A_19, "302928272625242322212019");
    assertEquals(parsedContent.NNR_A_20, "3029282726252423222120");
    assertEquals(parsedContent.NNR_A_21, "30292827262524232221");
    assertEquals(parsedContent.NNR_A_22, "302928272625242322");
    assertEquals(parsedContent.NNR_A_23, "3029282726252423");
    assertEquals(parsedContent.NNR_A_24, "30292827262524");
    assertEquals(parsedContent.NNR_A_25, "302928272625");
    assertEquals(parsedContent.NNR_A_26, "3029282726");
    assertEquals(parsedContent.NNR_A_27, "30292827");
    assertEquals(parsedContent.NNR_A_28, "302928");
    assertEquals(parsedContent.NNR_A_29, "3029");
    assertEquals(parsedContent.NNR_A_30, "30");

  });

}

runTests();
