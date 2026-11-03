//! Bounded local file responses. Authorization happens before this planner runs.
pub(crate) const RANGE_LIMIT:u64=4*1024*1024;
pub(crate) const WHOLE_LIMIT:u64=32*1024*1024;
#[derive(Debug,PartialEq)]
pub(crate) struct ReadPlan{pub start:u64,pub length:u64,pub partial:bool}
#[derive(Debug,PartialEq)]
pub(crate) enum ReadError{Unsatisfiable,RequiresExport}
pub(crate) fn plan(size:u64,range:Option<&str>,head:bool)->Result<ReadPlan,ReadError>{
 // Range applies to GET, not HEAD. HEAD advertises the complete representation.
 if head{return Ok(ReadPlan{start:0,length:size,partial:false})}
 let Some(range)=range else{if size>WHOLE_LIMIT{return Err(ReadError::RequiresExport)}return Ok(ReadPlan{start:0,length:size,partial:false})};
 let pair=range.strip_prefix("bytes=").and_then(|s|s.split_once('-')).ok_or(ReadError::Unsatisfiable)?;
 let number=|s:&str|if !s.is_empty()&&s.bytes().all(|b|b.is_ascii_digit()){s.parse::<u64>().ok()}else{None};
 if size==0{return Err(ReadError::Unsatisfiable)}
 let (start,end)=if pair.0.is_empty(){let suffix=number(pair.1).filter(|n|*n>0).ok_or(ReadError::Unsatisfiable)?;(size.saturating_sub(suffix),size-1)}else{
  let start=number(pair.0).filter(|n|*n<size).ok_or(ReadError::Unsatisfiable)?;
  let end=if pair.1.is_empty(){size-1}else{number(pair.1).filter(|n|*n>=start).ok_or(ReadError::Unsatisfiable)?.min(size-1)};(start,end)
 };
 Ok(ReadPlan{start,length:(end-start+1).min(RANGE_LIMIT),partial:true})
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn seek_suffix_head_and_large_files_are_bounded(){
  assert_eq!(plan(10,Some("bytes=-3"),false).unwrap(),ReadPlan{start:7,length:3,partial:true});
  assert_eq!(plan(10,Some("bytes=-100"),false).unwrap().length,10);
  assert_eq!(plan(10,Some("bytes=8-99"),false).unwrap(),ReadPlan{start:8,length:2,partial:true});
  assert_eq!(plan(10,Some("bytes=9-"),false).unwrap().length,1);
  assert_eq!(plan(0,None,false).unwrap().length,0);
  assert_eq!(plan(u64::MAX,Some("malformed"),true).unwrap(),ReadPlan{start:0,length:u64::MAX,partial:false});
  assert_eq!(plan(WHOLE_LIMIT+1,None,false),Err(ReadError::RequiresExport));
  assert_eq!(plan(WHOLE_LIMIT+1,Some("bytes=0-"),false).unwrap().length,RANGE_LIMIT);
  assert_eq!(plan(u64::MAX,Some("bytes=18446744073709551614-"),false).unwrap().length,1);
 }
 #[test]fn malformed_unsatisfiable_and_multipart_ranges_never_become_whole_reads(){
  for header in ["bytes=-0","bytes=-","bytes=10-","bytes=9-8","bytes=0-1,4-5","bytes=+1-2","bytes= 1-2","items=0-2","bytes=18446744073709551616-","bytes=0--1"]{assert_eq!(plan(10,Some(header),false),Err(ReadError::Unsatisfiable),"{header}");}
  assert_eq!(plan(0,Some("bytes=0-"),false),Err(ReadError::Unsatisfiable));
 }
}
