# qb-json-state

Functions for working with JSON parse state - a set of properties that have parsing recovery information for
parsers like qb-json-tokv.  ParseState could have been an object, but tok keep parsing engines light-weight
and unchanging, we require only that they work with the minimal state itself, with no object/behavior requirements.

## state overview

Parse state used by json parsing consists of the following properties:

    {
        src:                  // [byt] - the source buffer being read
        lim:                  // int limit to stop reading src (before)
        next_src              // [byt] - the next source buffer to continue reading (optional)
        vcount:               // int value count - number of values or key-values parsed so far (completed)
        koff:                 // int key offset
        klim:                 // int key limit
        tok:                  // int token - integer indicating what was parsed or encountered, see chart
        voff:                 // int value offset
        vlim:                 // int value limit
        stack:                // [byt] - ascii open brackets representing array or object containers and depth
        pos:                  // int - relative parse position code (before value, after key...) - see qb-json-tokv
    }

### Indexes: koff, klim, voff, vlim, and stack

The four integer offsets koff, klim, voff, and vlim hold the positions of key and value within source.  They are the
same ranges used in qb-json-tokv.  These integers are updated in the most minimal/efficient way as parsing progresses
through data.  vlim is always set to the last index parsed.  When offset equals limit (koff = klim or voff = vlim), there is no value.
String selections include quotes, so partial strings are detectable (length < 2 or no unescaped end quote).
Stack holds the in-container state.

For example:    

                                                                                  (ascii as strings)
                                                                                  
                                              koff    klim    voff    vlim        key   value   stack
    |-----------------------------------------   0       0       0       0                         
    |                                                                                              
    | |---------------------------------------   0       0       1       2                 {       {         
    | |                                                                                            
    | |       |-------------------------------   9      10      10      10        "                {
    | |       |                                                                                    
    | |       | |-----------------------------   9      12      12      12        "a"              {
    | |       | |                                                                                  
    | |       | | |---------------------------   9      12      14      14        "a"              {
    | |       | | |                                                                                
    | |       | | | |-------------------------   9      12      15      16        "a"      "       {
    | |       | | | |                                                                              
    | |       | | | |  |----------------------   9      12      15      19        "a"   "hi"       {
    | |       | | | |  |                                                                           
    | |       | | | |  |                       (key/value flushed out - to callback)               
    | |       | | | |  |                        12      12      19      19                         {
    | |       | | | |  |                                                                           
    | |       | | | |  |     |----------------  21      24      25      25        "b"              {
    | |       | | | |  |     |                                                                     
    | |       | | | |  |     | |--------------  21      24      26      27        "b"      [      {[
    | |       | | | |  |     | |                                                                   
    | |       | | | |  |     | |    |---------  24      24      32      32                        {[
    | |       | | | |  |     | |    |                                                              
    | |       | | | |  |     | |    | |-------  24      24      32      33                 ]       {
    | |       | | | |  |     | |    | |
    | |       | | | |  |     | |    | | |-----  24      24      35      36                 ]       
    | |       | | | |  |     | |    | | |
              1         2         3      
    01234567890123456789012345678901234567
     {       "a":  "hi", "b": [ 1, 2 ] }                           
    


## State Serialization Strings

qb1 encodes data into packets with begin and end state encoded as a concise path-like string.  For a series of JSON packets, a packet may
begin and end with the states

    begin:     0/0/{[{F
    end:       50/5/{[2L
    
meaning packet begins with:
                        
    0           0 bytes processed
    0           0 values processed 
    {[{F        inside object, then array, then object.  parse position before the very (F)irst value
        
and ends with:
    
    50          50 bytes processed 
    5           5 values processed
    {[V2        inside object then array within a truncated (V)alue 2 bytes long.  IOW, parsing is positioned
                within a value at bytes 48 and 49.
    
The details of **parse state** format is explained in detail below

#### Parse State ####

Parse state is all the parsing data needed to continue parsing from any point, including from within partially-parsed
keys and values.

Parse state format is designed to be very compact and yet somewhat intuitive.  It consists of
stack context, position, and end-code.

Stack context or simply 'stack' is a string of 
zero or more array or object open braces: '[{{[ ...' that indicate the depth and type of containers we are currently
within.  

parse-position is a position letter (F, J, K, L, U, V, or W) plus lengths of the pending key or
unfinished value.  parse-position can represent partial keys, values or any point between keys and values.

### parse state 'encoding' format

The grammer rules below may make parse states seem harder to understand then they truly are.  Put simply, all parse
states have a byte-count, value-count, and position-letter (F, J,K,L, U,V,W) indicating a specific position in parsing
an object.  K represents a truncated (K)ey, while V indicates a truncated (V)alue.  Letters before and after K (J and L) 
represent positions before and after key, while letters before and after V (U and W)represent positions before and after 
an array or object value.  Positions K, L, and V always have length counts while F, J, and W never have length
counts (they have no pending state), and U (before value) only has counts in object context to track pending
keys.

    state
        byte-count / value-count / parse-position
        byte-count / value-count / parse-position end-code
            
    byte-count
        nint
        
    value-count
        nint
          
    parse-position
        array-position                  root position (no array context) - comma-separated values
        array-stack array-position      in-array position
        object-stack object-position    in-object position
        
    array-position
        F                       before (F)irst value
            
        U                       before value    (after comma)
        V posint                within (V)alue  (posint number of bytes in value)
        W                       after value     (before comma)

    object-position
        F                       before first key/value
        
        J                       before key      (after comma)
        K posint                within (K)ey    (length number of bytes in key)
        L key-lengths           after key       (before colon)
        
        U key-lengths :         before value    (after colon)
        V key-lengths : posint  within value    (posint number of bytes in value) 
        W                       after value     (value sent.  before comma or object-end)

    key-lengths
        posint                  key length is posint bytes, no whitespace between key and value                                                            
        posint . ws-length      key length is posint bytes. whitespace bytes between key and value is ws-length
        
    ws-length
        posint
   
    array-stack             container stack in array context
        [
        brace array-stack
        
    object-stack            container stack in object context
        {
        brace object-stack                  

    end-code                     
        !U                  an (U)nexpected value or token was encountered (legal value, but unexpected order)
        !B                  a (B)ad value or byte was encountered (illegal byte)
        !T                  parsing ended on a (T)runcated value such as "a  (incomplete string)
        !D                  parsing ended on a (D)ecimal value which may be incomplete (might continue on the next src) 

    brace 
        {                   object context
        [                   array context
        
    nint                    non-negative integer
        0
        posint   

    posint                  positive integer
        non-zero-digit
        posint any-digit
        
   
#### parse position examples - root context and array

    > input                state

    >                      F                    before (F)irst value
    > [                    [F                   in array before the (F)irst value
    > [ 1                  [W                   in array after value
    > [ 1,                 [U                   in array before value (after comma)
    > [ 1, 2               [W                   in array after value  
    > [ 1, 2 ]             W                    value done. (i.e. array finished)
    
    root position allows comma-separated value lists, so we can continue...

    > [ 1, 2 ],            U                    before value (after comma)
    > [ 1, 2 ], null       W                    after value
    > [ 1, 2 ], null,      U                    before value

    etc...

#### object positions

    > input                             state

    > ''                                F                   before first value
    > '{'                               {F                  before first key/value
    > '{ "a"'                           {L3                 after key (3 byte key pending)
    > '{ "a":'                          {U3                 before value (3 byte key pending, no whitespace after)                     
    > '{ "a": '                         {U3.1               before value (3 byte key pending, 1 whitespace)                     
    > '{ "a": true'                     {W                  after value (nothing pending.  expecting comma)
    > '{ "a": true, '                   {U                  before value (nothing pending)              
    > '{ "a": true, "bc"'               {L4                 after key (4-byte key pending) 
    > '{ "a": true, "bc" :'             {L4.1               before value (4-byte key pending, 1 byte whitespace) 
    > '{ "a": true, "bc" : '            {U4.2               before value (4-byte key pending, 2 bytes whitespace)
    > '{ "a": true, "bc" : false'       {W                  after value    
    > '{ "a": true, "bc" : false }'     W                   value done   
    
#### unfinished parsing (buffer limit with partial values)

    > "ab                               V3                  3 byte truncated value
    > [ "ab", "c                        [V2                 2 byte truncated value in array
    > { "a                              {K2                 2 byte truncated key
    > { "a": true, "b                   {K2                 2 byte truncated key (same as above)
    > { "a":fal                         {V3:2               3 byte key and 3 byte truncated value
    > { "a" : fal                       {V3.2:3             3 byte key, 2 spaces, 3 byte truncated value
    
#### states with bad-bytes (!X)

    > q                    F!X                 (F)irst value is a bad byte
    > truq                 V3!X                3 valid bytes followed by a bad byte

    > [ q                  [F!X                (F)irst array value is a bad byte
    > [ 1 q                [W!X                bad byte after array value (where a comma was expected)
    > [ 1, q               [U!X                bad byte before array value (after comma, where a value was expected)
    > [ 1, 2 q             [W!X                bad byte after array value  
    > [ 1, 2 ] q           W!X                 bad byte after value
    > [ 1, 2 ], q          U!X                 bad byte before value

    > [ truq               [V3!X               3 valid bytes followed by a bad byte
    > [ true, truq         [V3!X               same (no distiction with first position)

#### states with unexpected tokens (!T)

    > }                    F!U                  unexpected token where (F)irst value was unexpected
    > [ }                  [F!T                 unexpected token where (F)irst value or end-array was unexpected
    > [ 1 2                [W!T                 unexpected value where comma was expceted
    > [ 1, ]               [U!T                 unexpected value where value was expected
    > [ 1, 2 ] true        [W!T                 unexpected value where comma was expected  
    > [ 1, 2 ], ,          U!T                  unexepcted token where value was expected
    
## Incremental Parsing and Packets

A chunk of data is called a "packet".  In Quicbit, packets contain a start and
end state which indicates the precise parse starting and ending point of a packet.  Quicbit is
able to start and end parsing at any point, even across split values (allowing split values
in packages is configurable).


### Packet Series ###
    
A series of packets prepends two comma-delimited sections to the packet single information described
above.  These sections track context counts and parsing state for split buffers.  Parse state handling
is designed to handle any-length key or value such as very large strings, that span packets without 
requiring data to be accumulated in memory.

            
Those are state representations with no prescient knowledge of updoming counts.   
If total counts are known, colon-values may be used to show 'out-of' totals as in
    
    0:5         0 out of 5 total values
    0:50        0 out of 50 total bytes
    
Which in the state string looks like this:
    
    0:5/0:50/{[/-

    