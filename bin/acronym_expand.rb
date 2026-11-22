# Spells out the first use of each registered acronym in every block of a note body, as
# "Full name (ACR)". Quotes (<q>, <blockquote>), code and existing <abbr> are left alone.
# Used by bin/build-decisions so regenerated notes stay compliant (see `bin/kb lint-acronyms`).
require "nokogiri"

module AcronymExpand
  ROOT = File.expand_path("..", __dir__)
  REGISTRY = File.readlines(File.join(ROOT, "bin", "acronyms.tsv"), chomp: true).drop(1)
    .reject(&:empty?).to_h { |l| l.split("\t", 2) }
  # Name used in running text (SMEC, URPS, HDS are their own names).
  OVERRIDE = { "DPTI" => "Department of Planning, Transport and Infrastructure", "SMEC" => nil, "URPS" => nil, "HDS" => "HDS Australia" }.freeze
  NAME = REGISTRY.to_h { |k, v| [k, OVERRIDE.key?(k) ? OVERRIDE[k] : v.split(/[,(]/).first.strip] }.compact
  RE = /(?<![\w-])(#{REGISTRY.keys.sort_by { |k| -k.size }.map { |k| Regexp.escape(k) }.join("|")})(?![\w-])/
  BLOCKS = %w[p li td th dd dt figcaption h1 h2 h3 caption blockquote].freeze
  NO_EXPAND = %w[script style code pre abbr title head q blockquote].freeze

  # SA inside proper names (Plan SA, Location SA, Renewal SA) or a postal address (... SA 5211).
  def self.protected_sa?(m, pre, post)
    m == "SA" && (pre.end_with?("Renewal ", "Plan ", "Location ") || post.start_with?(" Lambert", " Tenders") || post.match?(/\A \d{4}\b/))
  end

  def self.phrase(a, pre)
    full = NAME[a]
    return full if full.start_with?(a) # the name already contains the acronym (e.g. "SIDRA Intersection")
    open = pre.count("(") > pre.count(")")
    open ? "#{full} [#{a}]" : "#{full} (#{a})"
  end

  def self.expand(html)
    doc = Nokogiri::HTML5.fragment(html)
    doc.css(BLOCKS.join(",")).each do |b|
      next if b.css(BLOCKS.join(",")).any?
      text = b.text
      missing = text.scan(RE).flatten.uniq.select { |a| NAME[a] && !text.downcase.include?(NAME[a].downcase) }
      missing.each do |a|
        done = false
        nodes = b.xpath(".//text()").reject { |t| t.ancestors.any? { |x| NO_EXPAND.include?(x.name) } }
        nodes.each_with_index do |t, i|
          before = nodes[0...i].map(&:content).join
          t.content = t.content.gsub(RE) do |m|
            next m if done || m != a || protected_sa?(m, $~.pre_match, $~.post_match)
            done = true
            phrase(a, before + $~.pre_match)
          end
          break if done
        end
        next if done || a != "SA"
        nodes.each do |t|
          t.content = t.content.sub(/(?<![\w-])(Renewal|Plan|Location) SA\b/) { done = true; "South Australia's #{$&}" }
          break if done
        end
      end
    end
    doc.to_html
  end
end
